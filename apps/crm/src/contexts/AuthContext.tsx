import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@153/shared";
import { supabase } from "@/integrations/supabase/client";

export type ProfileState = "idle" | "loading" | "loaded" | "missing" | "error";

type FetchOutcome =
  | { kind: "loaded"; profile: Profile }
  | { kind: "missing" }
  | { kind: "error"; reason: string };

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  authLoading: boolean;
  profileState: ProfileState;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

const FETCH_TIMEOUT_MS = 8000;
// error: 400ms → 1200ms 재시도 (PostgREST 일시 오류, GRANT 미적용 등)
const ERROR_RETRY_DELAYS_MS = [400, 1200];
// missing: 600ms 후 1회 재시도 (신규 가입 직후 profile row 전파 지연 대응)
const MISSING_RETRY_DELAY_MS = 600;

async function fetchProfileOnce(userId: string): Promise<FetchOutcome> {
  try {
    const fetchPromise = supabase
      .from("profiles")
      .select("*")
      .eq("auth_user_id", userId)
      .maybeSingle();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("fetchProfile timeout")), FETCH_TIMEOUT_MS),
    );
    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
    if (error) {
      return { kind: "error", reason: error.message ?? "PostgREST error" };
    }
    if (!data) return { kind: "missing" };
    return { kind: "loaded", profile: data as unknown as Profile };
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : "unknown error" };
  }
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// loaded  → 즉시 확정
// missing → 600ms 후 1회 재시도 (신규 가입 직후 row 전파 지연 대응)
// error   → 400ms, 1200ms 재시도 후 최종 판정
async function fetchProfileWithRetry(
  userId: string,
  isCanceled: () => boolean,
): Promise<FetchOutcome> {
  let last: FetchOutcome = await fetchProfileOnce(userId);

  if (last.kind === "loaded") return last;

  // missing: 1회만 재시도
  if (last.kind === "missing") {
    if (isCanceled()) return last;
    await delay(MISSING_RETRY_DELAY_MS);
    if (isCanceled()) return last;
    last = await fetchProfileOnce(userId);
    if (last.kind !== "error") return last;
    // missing 재시도 후 error 가 됐으면 아래 error 재시도로 계속
  }

  // error: 최대 2회 재시도
  for (const wait of ERROR_RETRY_DELAYS_MS) {
    if (isCanceled()) return last;
    await delay(wait);
    if (isCanceled()) return last;
    last = await fetchProfileOnce(userId);
    if (last.kind !== "error") return last;
  }
  return last;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileState, setProfileState] = useState<ProfileState>("idle");

  // stale-request guard: 새 요청이 시작될 때마다 ++ 하고,
  // 응답이 도착하면 자기 reqId 가 최신인지 확인.
  const reqIdRef = useRef(0);
  // 같은 user.id 에 대해 진행 중인 요청이 있으면 INITIAL_SESSION 등의 중복 트리거 무시.
  const inflightUserRef = useRef<string | null>(null);

  const runFetch = useCallback(async (userId: string) => {
    if (inflightUserRef.current === userId) return; // 중복 방지
    inflightUserRef.current = userId;
    const myReq = ++reqIdRef.current;
    setProfileState("loading");

    const outcome = await fetchProfileWithRetry(
      userId,
      () => reqIdRef.current !== myReq,
    );

    // 도착 시점에 더 새 요청이 출발했으면 그 결과로 덮지 않는다.
    if (reqIdRef.current !== myReq) return;
    inflightUserRef.current = null;

    if (outcome.kind === "loaded") {
      setProfile(outcome.profile);
      setProfileState("loaded");
    } else if (outcome.kind === "missing") {
      setProfile(null);
      setProfileState("missing");
    } else {
      // error — 기존 profile 은 그대로 두고 상태만 error 로 표시 (가능하면 직전 데이터 유지)
      setProfileState("error");
    }
  }, []);

  const clearProfile = useCallback(() => {
    reqIdRef.current++; // in-flight 결과 무효화
    inflightUserRef.current = null;
    setProfile(null);
    setProfileState("idle");
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        if (data.session) {
          await runFetch(data.session.user.id);
        } else {
          setProfileState("idle");
        }
      } catch (e) {
        console.error("[AuthProvider] init error", e);
        if (mounted) setProfileState("error");
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (!mounted) return;
      // INITIAL_SESSION 은 getSession 이 이미 처리. 중복 fetch 방지.
      if (event === "INITIAL_SESSION") {
        setSession(sess);
        return;
      }
      setSession(sess);

      if (event === "SIGNED_OUT" || !sess) {
        clearProfile();
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void runFetch(sess.user.id);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [runFetch, clearProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearProfile();
  }, [clearProfile]);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      // 강제 재조회는 in-flight 가드를 우회해야 한다.
      inflightUserRef.current = null;
      await runFetch(session.user.id);
    }
  }, [session, runFetch]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      authLoading,
      profileState,
      signOut,
      refreshProfile,
    }),
    [session, profile, authLoading, profileState, signOut, refreshProfile],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

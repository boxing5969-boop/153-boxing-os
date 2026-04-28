import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@153/shared";
import { supabase } from "@/integrations/supabase/client";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const fetchPromise = supabase
      .from("profiles")
      .select("*")
      .eq("auth_user_id", userId)
      .maybeSingle();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("fetchProfile timeout")), 8000)
    );
    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
    if (error) {
      console.error("[fetchProfile]", error);
      return null;
    }
    if (!data) return null;
    return data as unknown as Profile;
  } catch (e) {
    console.error("[fetchProfile]", e);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let initialLoadDone = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        if (data.session) {
          const p = await fetchProfile(data.session.user.id);
          if (!mounted) return;
          setProfile(p);
        }
      } catch (e) {
        console.error("[AuthProvider] init error", e);
      } finally {
        if (mounted) {
          initialLoadDone = true;
          setLoading(false);
        }
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      if (!mounted) return;
      setSession(sess);
      if (sess) {
        const p = await fetchProfile(sess.user.id);
        if (!mounted) return;
        setProfile(p);
      } else {
        setProfile(null);
      }
      // onAuthStateChange가 초기 getSession보다 먼저 완료된 경우 loading 해제
      if (!initialLoadDone && mounted) {
        initialLoadDone = true;
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) {
      const p = await fetchProfile(session.user.id);
      setProfile(p);
    }
  }, [session]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signOut, refreshProfile]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

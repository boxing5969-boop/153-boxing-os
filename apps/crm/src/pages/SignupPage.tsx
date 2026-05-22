import { type FormEvent, useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, ArrowRight, Building2, User, MapPin,
  Eye, EyeOff, CheckCircle2, XCircle, Loader2,
} from "lucide-react";

// ── 스텝 정의
const STEPS = ["브랜드 정보", "관리자 계정", "첫 지점"] as const;
type Step = 0 | 1 | 2;

// ── slug 정규식: 영문 소문자·숫자·하이픈, 3-30자
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

interface FormData {
  company_name: string;
  slug: string;
  admin_name: string;
  admin_email: string;
  admin_password: string;
  admin_phone: string;
  branch_name: string;
  branch_phone: string;
}

export default function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormData>({
    company_name: "",
    slug: "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
    admin_phone: "",
    branch_name: "",
    branch_phone: "",
  });
  const [slugState, setSlugState] = useState<"idle" | "checking" | "ok" | "taken">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiBase = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

  function set(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "company_name" && form.slug === "") {
      // auto-fill slug from company name
      const auto = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30);
      setForm((prev) => ({ ...prev, company_name: value, slug: auto }));
      checkSlug(auto);
    }
  }

  function onSlugChange(raw: string) {
    const val = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setForm((prev) => ({ ...prev, slug: val }));
    checkSlug(val);
  }

  function checkSlug(val: string) {
    if (slugTimer.current) clearTimeout(slugTimer.current);
    if (!SLUG_RE.test(val)) { setSlugState("idle"); return; }
    setSlugState("checking");
    slugTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/api/onboarding/check-slug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: val }),
        });
        const json = await res.json() as { data?: { available?: boolean } };
        setSlugState(json.data?.available ? "ok" : "taken");
      } catch {
        setSlugState("idle");
      }
    }, 500);
  }

  function canProceed(): boolean {
    if (step === 0) {
      return (
        form.company_name.trim().length >= 2 &&
        SLUG_RE.test(form.slug) &&
        slugState === "ok"
      );
    }
    if (step === 1) {
      return (
        form.admin_name.trim().length >= 1 &&
        form.admin_email.includes("@") &&
        form.admin_password.length >= 8
      );
    }
    // step 2
    return form.branch_name.trim().length >= 1;
  }

  function next() {
    if (!canProceed()) return;
    if (step < 2) setStep((s) => (s + 1) as Step);
    else void handleSubmit();
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/onboarding/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name:   form.company_name.trim(),
          slug:           form.slug,
          admin_name:     form.admin_name.trim(),
          admin_email:    form.admin_email.trim().toLowerCase(),
          admin_password: form.admin_password,
          admin_phone:    form.admin_phone.trim(),
          branch_name:    form.branch_name.trim(),
          branch_phone:   form.branch_phone.trim(),
        }),
      });
      const json = await res.json() as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? "가입 중 오류가 발생했습니다.");
        setSubmitting(false);
        return;
      }
      // 성공 → 로그인 페이지로 (welcome 메시지)
      navigate("/login", { state: { welcome: true, email: form.admin_email } });
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex">
      {/* 왼쪽: 브랜드 패널 */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col bg-sidebar relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "32px 32px",
          }}
        />
        <div className="absolute -bottom-32 -left-32 size-96 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -top-32 -right-32 size-64 rounded-full bg-brand/10 blur-3xl" />

        <div className="relative flex flex-1 flex-col justify-between p-10">
          {/* 로고 */}
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-brand shadow-lg shadow-brand/30">
              <span className="text-sm font-black leading-none text-white">153</span>
            </div>
            <div>
              <p className="text-sm font-bold text-sidebar-foreground">153os</p>
              <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-widest">
                Gym OS
              </p>
            </div>
          </div>

          {/* 중앙 카피 */}
          <div className="space-y-6">
            <div className="space-y-3">
              <h1 className="text-3xl font-black text-sidebar-foreground leading-tight">
                프랜차이즈 짐 운영,<br />
                <span className="text-brand">이제 하나로.</span>
              </h1>
              <p className="text-sm text-sidebar-foreground/60 leading-relaxed">
                회원 관리부터 출입 통제, 알림톡까지.<br />
                153os 하나로 모든 지점을 관리하세요.
              </p>
            </div>

            {/* 기능 리스트 */}
            <ul className="space-y-2">
              {[
                "14일 무료 체험, 카드 등록 불필요",
                "지점별 회원·이용권 자동 관리",
                "출입 기기 연동 & 원격 제어",
                "만료 D-7/3/1 알림톡 자동 발송",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-sidebar-foreground/70">
                  <CheckCircle2 className="size-4 text-brand flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* 푸터 */}
          <p className="text-xs text-sidebar-foreground/30">
            © 2026 153os · 이용약관 · 개인정보처리방침
          </p>
        </div>
      </div>

      {/* 오른쪽: 폼 */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* 스텝 인디케이터 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <div
                    className={[
                      "flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors",
                      i < step
                        ? "bg-brand text-white"
                        : i === step
                        ? "bg-brand text-white ring-4 ring-brand/20"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {i < step ? <CheckCircle2 className="size-4" /> : i + 1}
                  </div>
                  <span
                    className={[
                      "text-xs font-medium",
                      i === step ? "text-foreground" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {label}
                  </span>
                  {i < STEPS.length - 1 && (
                    <div className={["flex-1 h-px w-6", i < step ? "bg-brand" : "bg-border"].join(" ")} />
                  )}
                </div>
              ))}
            </div>
            <h2 className="text-xl font-bold text-foreground">
              {step === 0 && "브랜드 정보를 입력해 주세요"}
              {step === 1 && "관리자 계정을 만들어 주세요"}
              {step === 2 && "첫 번째 지점을 등록해 주세요"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {step === 0 && "나중에 대시보드에서 변경할 수 있습니다."}
              {step === 1 && "이 계정으로 153os에 로그인하게 됩니다."}
              {step === 2 && "지점은 나중에 더 추가할 수 있습니다."}
            </p>
          </div>

          {/* 스텝 0: 브랜드 정보 */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="company_name">브랜드명 *</Label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="company_name"
                    className="h-11 rounded-xl pl-10"
                    placeholder="예: 153복싱짐"
                    value={form.company_name}
                    onChange={(e) => set("company_name", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="slug">
                  슬러그 *
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    (영문 소문자·숫자·하이픈, 3-30자)
                  </span>
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 select-none text-xs text-muted-foreground">
                    153os.kr/
                  </span>
                  <Input
                    id="slug"
                    className="h-11 rounded-xl pl-20"
                    placeholder="153boxing"
                    value={form.slug}
                    onChange={(e) => onSlugChange(e.target.value)}
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {slugState === "checking" && (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                    {slugState === "ok" && (
                      <CheckCircle2 className="size-4 text-green-500" />
                    )}
                    {slugState === "taken" && (
                      <XCircle className="size-4 text-destructive" />
                    )}
                  </div>
                </div>
                {slugState === "taken" && (
                  <p className="text-xs text-destructive">이미 사용 중인 슬러그입니다.</p>
                )}
                {slugState === "ok" && (
                  <p className="text-xs text-green-600">사용 가능합니다.</p>
                )}
              </div>
            </div>
          )}

          {/* 스텝 1: 관리자 계정 */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin_name">이름 *</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="admin_name"
                    className="h-11 rounded-xl pl-10"
                    placeholder="홍길동"
                    value={form.admin_name}
                    onChange={(e) => set("admin_name", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin_email">이메일 *</Label>
                <Input
                  id="admin_email"
                  type="email"
                  className="h-11 rounded-xl"
                  placeholder="admin@example.com"
                  value={form.admin_email}
                  onChange={(e) => set("admin_email", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin_password">비밀번호 * (8자 이상)</Label>
                <div className="relative">
                  <Input
                    id="admin_password"
                    type={showPassword ? "text" : "password"}
                    className="h-11 rounded-xl pr-10"
                    placeholder="••••••••"
                    value={form.admin_password}
                    onChange={(e) => set("admin_password", e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin_phone">
                  연락처
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(선택)</span>
                </Label>
                <Input
                  id="admin_phone"
                  type="tel"
                  className="h-11 rounded-xl"
                  placeholder="010-0000-0000"
                  value={form.admin_phone}
                  onChange={(e) => set("admin_phone", e.target.value)}
                />
              </div>
            </div>
          )}

          {/* 스텝 2: 첫 지점 */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="branch_name">지점명 *</Label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="branch_name"
                    className="h-11 rounded-xl pl-10"
                    placeholder="예: 153복싱짐 선릉역점"
                    value={form.branch_name}
                    onChange={(e) => set("branch_name", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="branch_phone">
                  지점 전화번호
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(선택)</span>
                </Label>
                <Input
                  id="branch_phone"
                  type="tel"
                  className="h-11 rounded-xl"
                  placeholder="02-0000-0000"
                  value={form.branch_phone}
                  onChange={(e) => set("branch_phone", e.target.value)}
                />
              </div>

              {/* 요약 카드 */}
              <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-5 text-sm shadow-card">
                <p className="font-semibold text-foreground">가입 요약</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                  <span>브랜드명</span>
                  <span className="font-medium text-foreground">{form.company_name}</span>
                  <span>슬러그</span>
                  <span className="font-medium text-foreground">/{form.slug}</span>
                  <span>관리자</span>
                  <span className="font-medium text-foreground">{form.admin_email}</span>
                </div>
                <div className="mt-2 border-t border-border pt-2 text-xs font-medium text-brand">
                  ✓ 14일 무료 체험 자동 시작
                </div>
              </div>
            </div>
          )}

          {/* 에러 */}
          {error && (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-card">
              {error}
            </div>
          )}

          {/* 버튼 */}
          <div className="flex items-center gap-3">
            {step > 0 && (
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-full"
                onClick={() => setStep((s) => (s - 1) as Step)}
                disabled={submitting}
              >
                <ArrowLeft className="mr-1.5 size-4" />
                이전
              </Button>
            )}
            <Button
              className="h-11 flex-1 rounded-full bg-brand hover:bg-brand/90"
              onClick={next}
              disabled={!canProceed() || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  처리 중…
                </>
              ) : step < 2 ? (
                <>
                  다음
                  <ArrowRight className="ml-1.5 size-4" />
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1.5 size-4" />
                  가입 완료
                </>
              )}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            이미 계정이 있으신가요?{" "}
            <Link to="/login" className="text-brand hover:underline font-medium">
              로그인
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

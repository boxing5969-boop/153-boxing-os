import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, User2, Phone, Calendar, Users,
  CheckCircle2, CreditCard, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { listBranches, listCoaches } from "@/services/lookups";
import { createMember } from "@/services/members";
import type { MemberStatus } from "@153/shared";
import { cn } from "@/lib/cn";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

function formatPhoneInput(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
  );
}

interface SuccessViewProps {
  memberId: string;
  memberName: string;
  onRegisterMembership: () => void;
}

function SuccessView({ memberId, memberName, onRegisterMembership }: SuccessViewProps) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-success/10 shadow-card">
        <CheckCircle2 className="size-9 text-success" />
      </div>
      <div>
        <h2 className="text-2xl font-black tracking-tight text-foreground">
          {memberName}님 등록 완료!
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          이용권을 바로 등록하시겠어요?
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row">
        <Button className="h-11 flex-1 gap-2 rounded-full" onClick={onRegisterMembership}>
          <CreditCard className="size-4" />
          이용권 바로 등록
        </Button>
        <Button variant="outline" className="h-11 flex-1 gap-2 rounded-full" onClick={() => navigate(`/members/${memberId}`)}>
          회원 상세 보기
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <button
        type="button"
        onClick={() => navigate("/members")}
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        목록으로 돌아가기
      </button>
    </div>
  );
}

export default function MemberNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isHq = profile ? HQ_ROLES.has(profile.role) : false;

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: isHq,
    staleTime: 60_000,
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [status, setStatus] = useState<MemberStatus>("trial");
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const [coachId, setCoachId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [createdMember, setCreatedMember] = useState<{ id: string; name: string } | null>(null);
  const [showMembershipDialog, setShowMembershipDialog] = useState(false);

  useEffect(() => {
    if (!isHq && profile?.branch_id) setBranchId(profile.branch_id);
  }, [isHq, profile?.branch_id]);

  const selectedBranch = useMemo(
    () => branchesQuery.data?.find((b) => b.id === branchId) ?? null,
    [branchesQuery.data, branchId]
  );

  const coachesQuery = useQuery({
    queryKey: ["coaches", branchId],
    queryFn: () => listCoaches(branchId),
    enabled: !!branchId,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: createMember,
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: ["members"] });
      setCreatedMember({ id: member.id, name: member.name });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "등록 실패");
    },
  });

  function resolveCompanyId(): string | null {
    if (selectedBranch) return selectedBranch.company_id;
    if (profile?.company_id) return profile.company_id;
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!branchId) { setError("지점을 선택하세요"); return; }
    const companyId = resolveCompanyId();
    if (!companyId) { setError("소속 본사 정보를 찾을 수 없습니다"); return; }
    createMutation.mutate({
      company_id: companyId,
      branch_id: branchId,
      name: name.trim(),
      phone: phone.replace(/-/g, "").trim() || undefined,
      birth_date: birthDate || undefined,
      gender: gender || undefined,
      status,
      assigned_coach_id: coachId || null,
    });
  }

  // 등록 완료 후 이용권 다이얼로그로 이동
  useEffect(() => {
    if (createdMember && showMembershipDialog) {
      navigate(`/members/${createdMember.id}?openMembership=1`);
    }
  }, [createdMember, showMembershipDialog, navigate]);

  const branchLabel = isHq
    ? (branchesQuery.data?.find((b) => b.id === branchId)?.name ?? "선택하세요")
    : (profile?.branch_id ?? "—");

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/members" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
            <ArrowLeft className="size-4" />
            회원 목록
          </Link>
          <h1 className="text-2xl font-black text-foreground">신규 회원 등록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">기본 정보를 입력하고 이용권을 바로 등록하세요</p>
        </div>
      </div>

      {createdMember ? (
        <Card className="rounded-2xl p-6">
          <SuccessView
            memberId={createdMember.id}
            memberName={createdMember.name}
            onRegisterMembership={() => {
              setShowMembershipDialog(true);
              navigate(`/members/${createdMember.id}`);
            }}
          />
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 기본 정보 섹션 */}
          <Card className="rounded-2xl">
            <CardContent className="pt-6">
              <SectionTitle icon={User2} title="기본 정보" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 이름 */}
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    이름 <span className="text-danger">*</span>
                  </Label>
                  <Input
                    id="name"
                    required
                    placeholder="홍길동"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* 전화번호 */}
                <div className="space-y-1.5">
                  <Label htmlFor="phone">전화번호</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="010-1234-5678"
                      value={phone}
                      onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* 생년월일 */}
                <div className="space-y-1.5">
                  <Label htmlFor="birth">생년월일</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="birth"
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* 성별 */}
                <div className="space-y-1.5">
                  <Label>성별</Label>
                  <div className="flex gap-2">
                    {[
                      { value: "", label: "선택 안함" },
                      { value: "male", label: "남" },
                      { value: "female", label: "여" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGender(opt.value)}
                        className={cn(
                          "flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                          gender === opt.value
                            ? "border-primary bg-primary/10 text-primary shadow-card"
                            : "border-border bg-card text-muted-foreground hover:border-primary/50"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 등록 설정 섹션 */}
          <Card className="rounded-2xl">
            <CardContent className="pt-6">
              <SectionTitle icon={Users} title="등록 설정" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 초기 상태 */}
                <div className="space-y-1.5">
                  <Label htmlFor="status">
                    초기 상태 <span className="text-danger">*</span>
                  </Label>
                  <div className="flex gap-2">
                    {[
                      { value: "trial", label: "체험" },
                      { value: "active", label: "정상" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStatus(opt.value as MemberStatus)}
                        className={cn(
                          "flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                          status === opt.value
                            ? "border-primary bg-primary/10 text-primary shadow-card"
                            : "border-border bg-card text-muted-foreground hover:border-primary/50"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 지점 */}
                <div className="space-y-1.5">
                  <Label htmlFor="branch">
                    지점 <span className="text-danger">*</span>
                  </Label>
                  {isHq ? (
                    <Select
                      id="branch"
                      value={branchId}
                      onChange={(e) => { setBranchId(e.target.value); setCoachId(""); }}
                      required
                      disabled={branchesQuery.isLoading}
                    >
                      <option value="">지점 선택</option>
                      {(branchesQuery.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </Select>
                  ) : (
                    <div className="flex h-10 items-center rounded-xl border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {branchLabel}
                    </div>
                  )}
                </div>

                {/* 담당 코치 */}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="coach">담당 코치</Label>
                  <Select
                    id="coach"
                    value={coachId}
                    onChange={(e) => setCoachId(e.target.value)}
                    disabled={!branchId || coachesQuery.isLoading}
                  >
                    <option value="">미지정</option>
                    {(coachesQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  {!branchId && (
                    <p className="text-xs text-muted-foreground">지점 선택 후 코치를 지정할 수 있습니다</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 에러 */}
          {error && (
            <div className="flex items-center gap-2 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 shadow-card">
              <div className="size-1.5 shrink-0 rounded-full bg-danger" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={createMutation.isPending || !name.trim()}
              className="h-11 gap-2 rounded-full px-7"
            >
              {createMutation.isPending ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  등록 중…
                </>
              ) : (
                "회원 등록"
              )}
            </Button>
            <Link to="/members">
              <Button type="button" variant="ghost" className="rounded-full text-muted-foreground">
                취소
              </Button>
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

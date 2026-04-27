import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { listBranches, listCoaches } from "@/services/lookups";
import { createMember } from "@/services/members";
import {
  MEMBER_STATUS_VALUES,
  memberStatusLabel,
} from "@/components/members/MemberStatusBadge";
import type { MemberStatus } from "@153/shared";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

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
      navigate(`/members/${member.id}`, { replace: true });
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

    if (!branchId) {
      setError("지점을 선택하세요");
      return;
    }
    const companyId = resolveCompanyId();
    if (!companyId) {
      setError("소속 본사 정보를 찾을 수 없습니다");
      return;
    }

    createMutation.mutate({
      company_id: companyId,
      branch_id: branchId,
      name: name.trim(),
      phone: phone.trim() || undefined,
      birth_date: birthDate || undefined,
      gender: gender || undefined,
      status,
      assigned_coach_id: coachId || null,
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="신규 회원 등록"
        action={
          <Link to="/members">
            <Button variant="outline">
              <ArrowLeft className="size-4" />
              목록으로
            </Button>
          </Link>
        }
      />

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">이름 *</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">전화번호</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="010-1234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth">생년월일</Label>
              <Input
                id="birth"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">성별</Label>
              <Select id="gender" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">선택 안함</option>
                <option value="male">남</option>
                <option value="female">여</option>
                <option value="other">기타</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">상태 *</Label>
              <Select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as MemberStatus)}
              >
                {MEMBER_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {memberStatusLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch">지점 *</Label>
              {isHq ? (
                <Select
                  id="branch"
                  value={branchId}
                  onChange={(e) => {
                    setBranchId(e.target.value);
                    setCoachId("");
                  }}
                  required
                  disabled={branchesQuery.isLoading}
                >
                  <option value="">선택하세요</option>
                  {(branchesQuery.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="branch"
                  value={profile?.branch_id ?? "—"}
                  disabled
                  className="opacity-70"
                />
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="coach">담당 코치</Label>
              <Select
                id="coach"
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                disabled={!branchId || coachesQuery.isLoading}
              >
                <option value="">미지정</option>
                {(coachesQuery.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "등록 중…" : "등록"}
            </Button>
            <Link to="/members">
              <Button type="button" variant="ghost">
                취소
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}

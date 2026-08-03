import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ScanFace, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirmDialog";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import { formatDate, formatPhone } from "@/lib/format";
import type { MemberStatus } from "@153/shared";
import {
  deactivateFaceEnrollment,
  listFaceEnrollments,
  setStaffGrant,
  type FaceEnrollmentRow,
} from "@/services/faceAttendance";

const MEMBER_STATUSES: MemberStatus[] = [
  "active", "trial", "expired", "suspended", "unpaid", "withdrawn",
];

function asMemberStatus(s: string): MemberStatus | null {
  return (MEMBER_STATUSES as string[]).includes(s) ? (s as MemberStatus) : null;
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {[120, 110, 80, 40, 80, 80].map((w, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded-md bg-muted animate-pulse" style={{ width: w }} />
        </td>
      ))}
      <td className="px-5 py-3.5" />
    </tr>
  );
}

export default function FaceEnrollmentsTab({ branchId }: { branchId: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<FaceEnrollmentRow | null>(null);
  const [staffTarget, setStaffTarget] = useState<FaceEnrollmentRow | null>(null); // 직원 지정 확인용
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["face-enrollments", branchId],
    queryFn: () => listFaceEnrollments(branchId),
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: (memberId: string) => deactivateFaceEnrollment(memberId),
    onSuccess: () => {
      setTarget(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["face-enrollments"] });
    },
    onError: (e) => {
      setTarget(null); // 검수 반영: 다이얼로그를 닫아야 에러 배너가 보인다(뒤에 가려 실패를 성공으로 오인)
      setError(e instanceof Error ? e.message : "등록 해제에 실패했습니다");
    },
  });

  // FC-4: 직원 통과 토글 — 관장·코치 등 이용권 없이 출입해야 하는 사람 (즉시 가역)
  const staffMutation = useMutation({
    mutationFn: (v: { memberId: string; enable: boolean }) => setStaffGrant(v.memberId, v.enable),
    onSuccess: () => {
      setStaffTarget(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["face-enrollments"] });
    },
    onError: (e) => {
      setStaffTarget(null);
      setError(e instanceof Error ? e.message : "직원 통과 변경에 실패했습니다");
    },
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    const digits = term.replace(/\D/g, "");
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        (digits.length > 1 && (r.phone ?? "").replace(/\D/g, "").includes(digits))
    );
  }, [data, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·전화번호 검색"
            className="w-64 pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground tabular">
          등록 회원 {rows.length.toLocaleString()}명
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {["회원", "연락처", "지점", "샷", "등록일", "동의일", ""].map((h, i) => (
                <th
                  key={i}
                  className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && [...Array(5)].map((_, i) => <SkeletonRow key={i} />)}

            {isError && (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center text-sm text-danger">
                  등록 현황을 불러오지 못했습니다
                </td>
              </tr>
            )}

            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <ScanFace className="size-8 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground">
                      {q ? "검색 결과가 없습니다" : "얼굴 등록 회원이 없습니다"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {q ? "다른 이름이나 번호로 검색해보세요" : "키오스크에서 등록하면 여기에 표시됩니다"}
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              !isError &&
              rows.map((r) => {
                const status = asMemberStatus(r.member_status);
                return (
                  <tr key={r.member_id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/members/${r.member_id}`)}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {r.name}
                        </button>
                        {r.is_staff && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            <ShieldCheck className="size-3" />
                            직원
                          </span>
                        )}
                        {/* 검수 반영: 직원 배지가 회원상태를 덮으면 "퇴사했는데 무기한 통과" 대상을
                            운영자가 식별할 수 없다 — 두 배지를 함께 보여준다. */}
                        {status && status !== "active" && <MemberStatusBadge status={status} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground tabular whitespace-nowrap">
                      {formatPhone(r.phone)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {r.branch_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground tabular">{r.shots}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground tabular whitespace-nowrap">
                      {formatDate(r.enrolled_at)}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground tabular whitespace-nowrap">
                      {formatDate(r.consent_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={staffMutation.isPending && staffTarget?.member_id === r.member_id}
                          className={
                            r.is_staff
                              ? "gap-1.5 text-muted-foreground"
                              : "gap-1.5 text-primary hover:bg-primary/10"
                          }
                          onClick={() => {
                            // 무기한 출입 권한이므로 지정·해제 모두 확인을 거친다(검수 반영)
                            setError(null);
                            setStaffTarget(r);
                          }}
                        >
                          <ShieldCheck className="size-3.5" />
                          {r.is_staff ? "직원 해제" : "직원 지정"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-danger hover:bg-danger/10"
                          onClick={() => {
                            setError(null);
                            setTarget(r);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          해제
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Card>

      <ConfirmDialog
        open={!!target}
        onClose={() => {
          if (!mutation.isPending) setTarget(null);
        }}
        title="얼굴 등록 해제"
        description={
          <div className="space-y-2">
            <p>
              <b>{target?.name}</b> 회원의 얼굴 등록을 해제합니다.
            </p>
            <p className="text-muted-foreground">
              키오스크 인식 대상에서 제외되고 생체정보 수집 동의가 철회 처리됩니다. 다시
              이용하려면 키오스크에서 재등록해야 합니다. (이미 켜져 있는 키오스크는 화면
              새로고침 후 반영)
            </p>
          </div>
        }
        confirmLabel="등록 해제"
        variant="destructive"
        pending={mutation.isPending}
        onConfirm={() => {
          if (target) mutation.mutate(target.member_id);
        }}
      />

      <ConfirmDialog
        open={!!staffTarget}
        onClose={() => {
          if (!staffMutation.isPending) setStaffTarget(null);
        }}
        title={staffTarget?.is_staff ? "직원 통과 해제" : "직원 통과 지정"}
        description={
          <div className="space-y-2">
            <p>
              <b>{staffTarget?.name}</b> 회원의 직원 통과를{" "}
              {staffTarget?.is_staff ? "해제합니다." : "설정합니다."}
            </p>
            <p className="text-muted-foreground">
              {staffTarget?.is_staff
                ? "앞으로는 이용권 상태에 따라 판정됩니다. 이용권이 없으면 거절돼요."
                : "이용권과 무관하게 기한 없이 출입이 허용됩니다. 관장·코치 등 직원에게만 사용하고, 퇴사 시 반드시 해제해주세요."}
            </p>
          </div>
        }
        confirmLabel={staffTarget?.is_staff ? "해제" : "직원으로 지정"}
        variant={staffTarget?.is_staff ? "outline" : "default"}
        pending={staffMutation.isPending}
        onConfirm={() => {
          if (staffTarget) {
            staffMutation.mutate({ memberId: staffTarget.member_id, enable: !staffTarget.is_staff });
          }
        }}
      />
    </div>
  );
}

/**
 * CRM 8단계 퍼널 — 칸반 보드.
 *
 * 권한: BRANCH_AND_HQ + staff/coach 까지 조회·이동 가능 (move_member_stage RPC 가 권한 검증)
 * Drag-and-drop: HTML5 native (의존성 추가 없음)
 * 모바일: 가로 스크롤 (sm:overflow-x-auto)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import {
  listMembersForPipeline,
  listStageLogs,
  moveMemberStage,
  STAGES,
  STAGE_LABEL,
  type CrmStage,
  type MemberCard,
  type StageLog,
} from "@/services/crmPipeline";

// 표시 컬럼 — Stage 5 는 intensive/normal 같은 컬럼 안에 sub-group 으로
const COLUMN_KEYS: (CrmStage | "stage_5_combined")[] = [
  "stage_1",
  "stage_2",
  "stage_3",
  "stage_4",
  "stage_5_combined",
  "stage_6",
  "stage_7",
  "stage_8",
];

const CHURN_LABEL: Record<string, string> = {
  trial_not_purchased: "체험 미구매",
  trial_dropped: "체험 후 이탈",
  membership_expired: "회원권 만료",
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function MemberCardItem({
  m,
  onClick,
  onDragStart,
}: {
  m: MemberCard;
  onClick: () => void;
  onDragStart: (memberId: string, fromStage: CrmStage) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", m.id);
        onDragStart(m.id, m.crm_stage);
      }}
      onClick={onClick}
      className="cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-sm hover:border-slate-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium truncate text-slate-900">{m.name}</div>
        {m.churn_reason && (
          <span className="text-[10px] rounded-full bg-rose-50 text-rose-700 px-1.5 py-0.5">
            {CHURN_LABEL[m.churn_reason] ?? m.churn_reason}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-slate-500 tabular-nums">{m.phone}</div>
      {m.crm_stage === "stage_5_intensive" && m.intensive_until && (
        <div className="mt-1 text-[10px] text-amber-700">
          집중 케어 ~ {fmtDate(m.intensive_until)}
        </div>
      )}
      <div className="mt-1 text-[10px] text-slate-400">{fmtDate(m.stage_changed_at)} 이동</div>
    </div>
  );
}

function ColumnHeader({ count, label }: { count: number; label: string }) {
  return (
    <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-lg">
      <div className="text-xs font-semibold text-slate-700 truncate">{label}</div>
      <div className="text-[10px] font-bold tabular-nums text-slate-500 bg-white rounded-full px-1.5 py-0.5 ring-1 ring-slate-200">
        {count}
      </div>
    </div>
  );
}

function Drawer({
  member,
  onClose,
}: {
  member: MemberCard;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<StageLog[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const l = await listStageLogs(member.id, 30);
        if (!cancelled) setLogs(l);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30"
      onClick={onClose}
    >
      <div
        className="w-full sm:w-96 h-full bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="font-semibold">{member.name}</div>
            <div className="text-xs text-slate-500 tabular-nums">{member.phone}</div>
          </div>
          <button onClick={onClose} className="text-xs text-slate-500 px-2 py-1 hover:bg-slate-100 rounded">
            닫기
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500">현재 단계</div>
              <div className="font-medium">
                {STAGE_LABEL[member.crm_stage]}
                {member.churn_reason && ` · ${CHURN_LABEL[member.churn_reason]}`}
              </div>
            </div>
            <div>
              <div className="text-slate-500">상태</div>
              <div className="font-medium">{member.status}</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1.5">단계 이동 이력</div>
            {loading ? (
              <div className="text-xs text-slate-400">불러오는 중…</div>
            ) : logs.length === 0 ? (
              <div className="text-xs text-slate-400">이력 없음</div>
            ) : (
              <ul className="space-y-2">
                {logs.map((l) => (
                  <li key={l.id} className="text-xs border-l-2 border-slate-200 pl-2">
                    <div>
                      {l.from_stage ? (
                        <span className="text-slate-400">{STAGE_LABEL[l.from_stage as CrmStage] ?? l.from_stage} → </span>
                      ) : null}
                      <span className="font-medium">{STAGE_LABEL[l.to_stage as CrmStage] ?? l.to_stage}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {fmtDateTime(l.changed_at)} · {l.source}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const HQ_ROLES = ["super_admin", "hq_admin", "owner"];

export default function PipelineBoardPage() {
  const { profile } = useAuth();
  const [members, setMembers] = useState<MemberCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerMember, setDrawerMember] = useState<MemberCard | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const isHq = profile?.role && HQ_ROLES.includes(profile.role);
  // HQ 는 전체 branch, 그 외는 자기 branch 만 (RLS 가 추가로 보호)
  const branchId = isHq ? undefined : profile?.branch_id ?? undefined;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMembersForPipeline({ branchId });
      setMembers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const m: Record<string, MemberCard[]> = {};
    for (const s of STAGES) m[s] = [];
    for (const card of members) {
      m[card.crm_stage]?.push(card);
    }
    return m;
  }, [members]);

  async function handleDrop(toColumn: typeof COLUMN_KEYS[number], memberId: string) {
    setDragOverColumn(null);
    setDraggingId(null);
    const card = members.find((m) => m.id === memberId);
    if (!card) return;

    // stage_5_combined 컬럼에 떨어뜨리면 default = stage_5_normal
    // (집중 케어는 시간 기반 자동 전이가 자연스러움)
    const toStage: CrmStage =
      toColumn === "stage_5_combined" ? "stage_5_normal" : toColumn;
    if (card.crm_stage === toStage) return;

    setSavingId(memberId);
    try {
      await moveMemberStage({ memberId, toStage });
      setToast({ ok: true, msg: `${card.name} → ${STAGE_LABEL[toStage]}` });
      // 낙관적 업데이트
      setMembers((prev) =>
        prev.map((c) => (c.id === memberId ? { ...c, crm_stage: toStage, stage_changed_at: new Date().toISOString() } : c))
      );
    } catch (e) {
      setToast({ ok: false, msg: e instanceof Error ? e.message : "이동 실패" });
    } finally {
      setSavingId(null);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="CRM 파이프라인"
        description="8단계 회원 퍼널 — 드래그로 단계 이동, 카드 클릭으로 이력"
      />

      {error && <div className="text-sm text-rose-700 bg-rose-50 rounded p-3">{error}</div>}

      {toast && (
        <div
          className={`text-xs rounded p-2 ${
            toast.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="overflow-x-auto -mx-2 px-2 pb-4">
        <div className="flex gap-3 min-w-max">
          {COLUMN_KEYS.map((col) => {
            const isCombined = col === "stage_5_combined";
            const cards = isCombined
              ? [...(grouped["stage_5_intensive"] ?? []), ...(grouped["stage_5_normal"] ?? [])]
              : grouped[col] ?? [];
            const label = isCombined
              ? "신규 회원 (집중/일반)"
              : STAGE_LABEL[col as CrmStage];

            const isOver = dragOverColumn === col;
            return (
              <div
                key={col}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverColumn(col);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) void handleDrop(col, id);
                }}
                className={`w-72 shrink-0 rounded-lg border bg-slate-50/50 transition-colors ${
                  isOver ? "border-blue-400 bg-blue-50/50" : "border-slate-200"
                }`}
              >
                <ColumnHeader count={cards.length} label={label} />
                <div className="p-2 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto">
                  {loading && cards.length === 0 ? (
                    <div className="text-xs text-slate-400 p-2">불러오는 중…</div>
                  ) : cards.length === 0 ? (
                    <div className="text-xs text-slate-400 p-2 text-center">비어있음</div>
                  ) : (
                    cards.map((m) => (
                      <div key={m.id} className={savingId === m.id ? "opacity-50" : ""}>
                        <MemberCardItem
                          m={m}
                          onClick={() => setDrawerMember(m)}
                          onDragStart={(id) => setDraggingId(id)}
                        />
                        {isCombined && (
                          <div className="text-[9px] text-slate-400 mt-0.5 px-1">
                            {m.crm_stage === "stage_5_intensive" ? "집중 케어" : "일반"}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {draggingId && (
        <div className="text-[10px] text-slate-400">드래그 중… (떨어뜨릴 컬럼 클릭)</div>
      )}

      {drawerMember && (
        <Drawer member={drawerMember} onClose={() => setDrawerMember(null)} />
      )}
    </div>
  );
}

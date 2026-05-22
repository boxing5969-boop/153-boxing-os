/**
 * 회원만족 설문 목록 페이지 (/surveys)
 * - 설문 템플릿 목록 표시
 * - 새 설문 생성 (인라인 폼)
 * - 기본 질문 5개 자동 생성
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ClipboardCheck, ChevronRight,
  ToggleLeft, ToggleRight, ArchiveX, Building2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  listSurveyTemplates, createSurveyWithDefaults, updateSurveyTemplate,
  getSurveyResponseCount,
  type SurveyTemplate,
} from "@/services/surveys";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/cn";

// ── 지점 목록 조회 (본사 계정용) ──────────────────────────────
async function listBranches(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("branches")
    .select("id,name")
    .eq("status", "active")
    .order("name");
  return (data ?? []) as { id: string; name: string }[];
}

// ── 상태 뱃지 ────────────────────────────────────────────────
const STATUS_MAP = {
  active:   { label: "활성", cls: "bg-success/10 text-success" },
  inactive: { label: "비활성", cls: "bg-muted text-muted-foreground" },
  archived: { label: "보관", cls: "bg-muted text-muted-foreground" },
};

function StatusBadge({ status }: { status: SurveyTemplate["status"] }) {
  const m = STATUS_MAP[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", m.cls)}>
      {m.label}
    </span>
  );
}

// ── 응답 수 표시 (개별 쿼리) ─────────────────────────────────
function ResponseCount({ templateId }: { templateId: string }) {
  const { data = 0 } = useQuery({
    queryKey: ["survey-response-count", templateId],
    queryFn: () => getSurveyResponseCount(templateId),
    staleTime: 60_000,
  });
  return <span className="text-sm tabular text-muted-foreground">{data}건</span>;
}

// ── 설문 생성 폼 ─────────────────────────────────────────────
interface CreateFormProps {
  branchId: string;
  profileId: string;
  onDone: () => void;
}

function CreateForm({ branchId, profileId, onDone }: CreateFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createSurveyWithDefaults({
        branch_id: branchId,
        title: title.trim(),
        description: description.trim() || undefined,
        created_by: profileId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["survey-templates", branchId] });
      onDone();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "생성 실패"),
  });

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-5 space-y-3">
      <p className="text-sm font-semibold text-foreground">새 설문 만들기</p>
      <div className="space-y-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">설문 제목 <span className="text-danger">*</span></span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 153복싱 고객 만족도 조사"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">설명 (선택)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설문에 대한 간단한 안내 문구"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        기본 질문 5개 (만족도 × 4, 추천 여부 × 1) 가 자동으로 추가됩니다.
      </p>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!title.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "생성 중…" : "설문 생성"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────
export default function SurveysListPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  const profileId = profile?.id ?? "";
  const isHq = profile?.role === "super_admin" || profile?.role === "hq_admin";

  // 본사 계정이면 지점 목록 로드
  const { data: branches = [] } = useQuery({
    queryKey: ["branches-list"],
    queryFn: listBranches,
    enabled: isHq,
    staleTime: 5 * 60_000,
  });

  // 실제 사용할 branch_id: 지점 계정은 profile 값, 본사는 선택값
  const effectiveBranchId = isHq ? selectedBranchId : (profile?.branch_id ?? "");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["survey-templates", effectiveBranchId],
    queryFn: () => listSurveyTemplates(effectiveBranchId),
    enabled: !!effectiveBranchId,
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SurveyTemplate["status"] }) =>
      updateSurveyTemplate(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["survey-templates", effectiveBranchId] }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => updateSurveyTemplate(id, { status: "archived" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["survey-templates", effectiveBranchId] }),
  });

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
            <ClipboardCheck className="size-6 text-primary" />
            회원 만족도 설문
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            QR 코드로 회원 만족도를 수집하세요
          </p>
        </div>
        <Button
          onClick={() => setShowCreate((v) => !v)}
          className="gap-1.5"
          disabled={isHq && !selectedBranchId}
        >
          <Plus className="size-4" />
          새 설문
        </Button>
      </div>

      {/* 본사 계정용 지점 선택 */}
      {isHq && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <Building2 className="size-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground shrink-0">지점 선택</span>
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setSelectedBranchId(e.target.value);
              setShowCreate(false);
            }}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— 지점을 선택하세요 —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 생성 폼 */}
      {showCreate && effectiveBranchId && (
        <CreateForm
          branchId={effectiveBranchId}
          profileId={profileId}
          onDone={() => setShowCreate(false)}
        />
      )}

      {/* 목록 */}
      {isHq && !selectedBranchId ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            위에서 지점을 선택하면 해당 지점의 설문 목록이 표시됩니다.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 w-full animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            아직 설문이 없습니다. 위 버튼으로 첫 설문을 만들어보세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-2xl border border-border bg-card shadow-card hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-4 px-5 py-4">
                {/* 메인 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/surveys/${t.id}`}
                      className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate"
                    >
                      {t.title}
                    </Link>
                    <StatusBadge status={t.status} />
                  </div>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground truncate">{t.description}</p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    응답 수: <ResponseCount templateId={t.id} />
                    <span className="mx-1.5">·</span>
                    {new Date(t.created_at).toLocaleDateString("ko-KR")} 생성
                  </p>
                </div>

                {/* 액션 */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* 활성/비활성 토글 */}
                  <button
                    title={t.status === "active" ? "비활성화" : "활성화"}
                    onClick={() =>
                      toggleMutation.mutate({
                        id: t.id,
                        status: t.status === "active" ? "inactive" : "active",
                      })
                    }
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {t.status === "active"
                      ? <ToggleRight className="size-5 text-success" />
                      : <ToggleLeft className="size-5" />}
                  </button>

                  {/* 보관 */}
                  <button
                    title="보관 처리"
                    onClick={() => {
                      if (confirm(`"${t.title}" 설문을 보관하시겠습니까?`)) {
                        archiveMutation.mutate(t.id);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-danger"
                  >
                    <ArchiveX className="size-4" />
                  </button>

                  {/* 상세 링크 */}
                  <Link
                    to={`/surveys/${t.id}`}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

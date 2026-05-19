/**
 * 설문 상세 페이지 (/surveys/:id)
 * 탭 구성:
 *   - 질문 편집
 *   - QR 관리 (발급 · URL 복사 · 인쇄)
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Trash2, GripVertical,
  QrCode, Copy, Check, Printer, ExternalLink,
  ToggleLeft, ToggleRight, PencilLine, Save, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  getSurveyTemplate, updateSurveyTemplate,
  listSurveyQuestions, upsertSurveyQuestion, deleteSurveyQuestion,
  listSurveyQrCodes, createSurveyQrCode, updateSurveyQrCode,
  buildSurveyUrl,
  type SurveyQuestion, type SurveyQrCode, type QuestionType,
  type UpsertQuestionInput,
} from "@/services/surveys";
import { cn } from "@/lib/cn";

// ── 질문 타입 레이블 ─────────────────────────────────────────
const Q_TYPE_LABELS: Record<QuestionType, string> = {
  rating: "별점 (1~5)",
  multiple_choice: "객관식",
  text: "주관식",
  yes_no: "예/아니오",
};

// ── 탭 타입 ──────────────────────────────────────────────────
type Tab = "questions" | "qr";

// ════════════════════════════════════════════════════════════
// 질문 행
// ════════════════════════════════════════════════════════════
function QuestionRow({
  q,
  onDelete,
}: {
  q: SurveyQuestion;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 group">
      <GripVertical className="size-4 mt-0.5 text-muted-foreground/30 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
            {Q_TYPE_LABELS[q.question_type]}
          </span>
          {q.is_required && (
            <span className="text-[10px] text-danger font-medium">필수</span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">{q.question_text}</p>
      </div>
      <button
        onClick={() => onDelete(q.id)}
        className="shrink-0 p-1 rounded text-muted-foreground/40 hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
        title="질문 삭제"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 질문 추가 폼
// ════════════════════════════════════════════════════════════
function AddQuestionForm({
  templateId,
  nextIndex,
  onDone,
}: {
  templateId: string;
  nextIndex: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [qType, setQType] = useState<QuestionType>("rating");
  const [qText, setQText] = useState("");
  const [required, setRequired] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const input: UpsertQuestionInput = {
        survey_template_id: templateId,
        order_index: nextIndex,
        question_type: qType,
        question_text: qText.trim(),
        options: qType === "rating"
          ? { min: 1, max: 5, labels: { "1": "매우 불만족", "5": "매우 만족" } }
          : null,
        is_required: required,
      };
      return upsertSurveyQuestion(input);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["survey-questions", templateId] });
      onDone();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "저장 실패"),
  });

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground">질문 추가</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">질문 유형</span>
          <select
            value={qType}
            onChange={(e) => setQType(e.target.value as QuestionType)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {(Object.keys(Q_TYPE_LABELS) as QuestionType[]).map((k) => (
              <option key={k} value={k}>{Q_TYPE_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">질문 내용 <span className="text-danger">*</span></span>
          <input
            autoFocus
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            placeholder="질문을 입력하세요"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
          className="rounded"
        />
        필수 질문
      </label>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!qText.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "저장 중…" : "추가"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// QR 코드 행
// ════════════════════════════════════════════════════════════
function QrRow({ qr, onToggle }: { qr: SurveyQrCode; onToggle: () => void }) {
  const url = buildSurveyUrl(qr.slug);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>설문 QR 인쇄 - ${qr.label ?? "설문"}</title>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column;
           align-items: center; justify-content: center; min-height: 100vh;
           margin: 0; padding: 32px; box-sizing: border-box; }
    .label { font-size: 20px; font-weight: 700; margin-bottom: 12px; }
    .url { font-size: 13px; color: #555; word-break: break-all; margin-top: 16px;
           max-width: 400px; text-align: center; }
    .box { border: 2px solid #000; border-radius: 12px; padding: 24px 32px;
           display: flex; flex-direction: column; align-items: center; }
    img { width: 240px; height: 240px; }
    .hint { font-size: 12px; color: #888; margin-top: 8px; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="box">
    <p class="label">${qr.label ?? "회원 만족도 설문"}</p>
    <p class="hint">QR 코드 스캔 또는 아래 링크 접속</p>
    <p class="url">${url}</p>
  </div>
  <script>window.onload = () => window.print();<\/script>
</body>
</html>`);
    w.document.close();
  }

  const isExpired = qr.valid_until ? new Date(qr.valid_until) < new Date() : false;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <QrCode className="size-5 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {qr.label ?? "QR 코드"}
            </span>
            <span className={cn(
              "text-[10px] rounded-full px-2 py-0.5 font-semibold",
              qr.status === "active" && !isExpired
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground"
            )}>
              {isExpired ? "만료됨" : qr.status === "active" ? "활성" : "비활성"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{url}</p>
          {qr.valid_until && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              만료일: {new Date(qr.valid_until).toLocaleDateString("ko-KR")}
            </p>
          )}

          {/* 액션 버튼 */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted transition-colors"
            >
              {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
              {copied ? "복사됨" : "링크 복사"}
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted transition-colors"
            >
              <Printer className="size-3" />
              인쇄 미리보기
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted transition-colors"
            >
              <ExternalLink className="size-3" />
              링크 열기
            </a>
            <button
              onClick={onToggle}
              className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2.5 py-1 hover:bg-muted transition-colors"
            >
              {qr.status === "active"
                ? <><ToggleRight className="size-3 text-success" />비활성화</>
                : <><ToggleLeft className="size-3" />활성화</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// QR 발급 폼
// ════════════════════════════════════════════════════════════
function CreateQrForm({
  branchId, templateId, profileId, onDone,
}: {
  branchId: string; templateId: string; profileId: string; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createSurveyQrCode({
        branch_id: branchId,
        survey_template_id: templateId,
        label: label.trim() || undefined,
        valid_until: validUntil || null,
        created_by: profileId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["survey-qr-codes", templateId] });
      onDone();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "발급 실패"),
  });

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground">새 QR 발급</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">QR 설명 (선택)</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="예: 프론트 데스크, 1층 입구"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">만료일 (선택 · 비워두면 무기한)</span>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "발급 중…" : "QR 발급"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>취소</Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════
export default function SurveyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("questions");
  const [showAddQ, setShowAddQ] = useState(false);
  const [showAddQr, setShowAddQr] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const branchId = profile?.branch_id ?? "";
  const profileId = profile?.id ?? "";

  // ── 데이터 쿼리 ───────────────────────────────────────────
  const { data: template, isLoading: tmplLoading } = useQuery({
    queryKey: ["survey-template", id],
    queryFn: () => getSurveyTemplate(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: questions = [], isLoading: qLoading } = useQuery({
    queryKey: ["survey-questions", id],
    queryFn: () => listSurveyQuestions(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const { data: qrCodes = [], isLoading: qrLoading } = useQuery({
    queryKey: ["survey-qr-codes", id],
    queryFn: () => listSurveyQrCodes(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  // ── 뮤테이션 ──────────────────────────────────────────────
  const saveTitleMutation = useMutation({
    mutationFn: () => updateSurveyTemplate(id!, { title: titleDraft.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["survey-template", id] });
      void qc.invalidateQueries({ queryKey: ["survey-templates", branchId] });
      setEditingTitle(false);
    },
  });

  const deleteQMutation = useMutation({
    mutationFn: deleteSurveyQuestion,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["survey-questions", id] }),
  });

  const toggleQrMutation = useMutation({
    mutationFn: ({ qrId, status }: { qrId: string; status: SurveyQrCode["status"] }) =>
      updateSurveyQrCode(qrId, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["survey-qr-codes", id] }),
  });

  // ── 로딩/에러 ─────────────────────────────────────────────
  if (tmplLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (!template) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        설문을 찾을 수 없습니다.{" "}
        <Link to="/surveys" className="text-primary hover:underline">목록으로</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate(-1)}
          className="mt-0.5 p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="text-xl font-black rounded-md border border-input bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring w-full max-w-sm"
              />
              <button
                onClick={() => saveTitleMutation.mutate()}
                disabled={!titleDraft.trim() || saveTitleMutation.isPending}
                className="p-1.5 rounded-lg hover:bg-muted text-success"
              >
                <Save className="size-4" />
              </button>
              <button
                onClick={() => setEditingTitle(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              className="flex items-center gap-2 group"
              onClick={() => { setTitleDraft(template.title); setEditingTitle(true); }}
            >
              <h1 className="text-xl font-black text-foreground">{template.title}</h1>
              <PencilLine className="size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
            </button>
          )}
          {template.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "questions" as Tab, label: "질문 편집" },
          { key: "qr" as Tab, label: "QR 관리" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            {key === "questions" && (
              <span className="ml-1.5 text-[10px] rounded-full bg-muted px-1.5 py-0.5">
                {questions.length}
              </span>
            )}
            {key === "qr" && (
              <span className="ml-1.5 text-[10px] rounded-full bg-muted px-1.5 py-0.5">
                {qrCodes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── 질문 탭 ─────────────────────────────────────────── */}
      {tab === "questions" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowAddQ((v) => !v)} className="gap-1.5">
              <Plus className="size-3.5" />
              질문 추가
            </Button>
          </div>

          {showAddQ && (
            <AddQuestionForm
              templateId={id!}
              nextIndex={questions.length}
              onDone={() => setShowAddQ(false)}
            />
          )}

          {qLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : questions.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                질문이 없습니다. 위 버튼으로 추가하세요.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  onDelete={(qid) => {
                    if (confirm("이 질문을 삭제하시겠습니까?")) {
                      deleteQMutation.mutate(qid);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── QR 탭 ───────────────────────────────────────────── */}
      {tab === "qr" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              QR을 스캔하거나 링크를 공유하면 회원이 설문에 응답할 수 있습니다.
            </p>
            <Button size="sm" variant="outline" onClick={() => setShowAddQr((v) => !v)} className="gap-1.5">
              <Plus className="size-3.5" />
              QR 발급
            </Button>
          </div>

          {showAddQr && (
            <CreateQrForm
              branchId={branchId}
              templateId={id!}
              profileId={profileId}
              onDone={() => setShowAddQr(false)}
            />
          )}

          {/* QR 이미지 미지원 안내 */}
          <div className="rounded-lg bg-warning/5 border border-warning/20 px-4 py-3 text-xs text-warning">
            💡 QR 이미지 생성 기능은 라이브러리 추가가 필요합니다. 현재는 링크 복사 및 인쇄 기능을 지원합니다.
          </div>

          {qrLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : qrCodes.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                발급된 QR 코드가 없습니다. 위 버튼으로 발급하세요.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {qrCodes.map((qr) => (
                <QrRow
                  key={qr.id}
                  qr={qr}
                  onToggle={() =>
                    toggleQrMutation.mutate({
                      qrId: qr.id,
                      status: qr.status === "active" ? "inactive" : "active",
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

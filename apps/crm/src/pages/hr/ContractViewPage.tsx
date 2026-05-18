/**
 * 공개 계약서 뷰 페이지 — 로그인 없이 접근 가능
 * 직원이 SMS 링크를 통해 열람
 */
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL as string;

interface PublicContract {
  id: string;
  title: string;
  contract_type: string;
  content: { body?: string } | null;
  valid_from: string | null;
  valid_until: string | null;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  staff: { name: string; position: string | null; employment_type: string } | null;
}

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  employment: "근로계약서",
  parttime: "단시간 근로계약서",
  freelance: "업무위탁계약서",
  renewal: "계약 갱신서",
  other: "기타 계약서",
};

const STATUS_INFO: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  draft: { label: "초안", icon: Clock, color: "text-muted-foreground" },
  sent: { label: "검토 요청됨", icon: Clock, color: "text-blue-600" },
  signed: { label: "서명 완료", icon: CheckCircle2, color: "text-success" },
  expired: { label: "기간 만료", icon: AlertTriangle, color: "text-warning" },
  canceled: { label: "취소됨", icon: AlertTriangle, color: "text-danger" },
};

export default function ContractViewPage() {
  const { contractId = "" } = useParams();

  const { data: contract, isLoading, error } = useQuery({
    queryKey: ["contract-view", contractId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/hr/contracts/${contractId}/view`);
      const json = await res.json() as { success: boolean; data: PublicContract; message?: string };
      if (!json.success) throw new Error(json.message ?? "계약서를 불러올 수 없습니다");
      return json.data;
    },
    enabled: !!contractId,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-3">
          <div className="size-10 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">계약서를 불러오는 중…</p>
        </div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-3 max-w-sm px-6">
          <AlertTriangle className="size-12 text-warning mx-auto" />
          <h1 className="text-lg font-bold text-foreground">계약서를 찾을 수 없습니다</h1>
          <p className="text-sm text-muted-foreground">
            {(error as Error)?.message ?? "링크가 만료되었거나 잘못된 주소입니다."}
          </p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_INFO[contract.status] ?? STATUS_INFO["sent"];
  const StatusIcon = statusInfo.icon;
  const contractBody = contract.content?.body ?? "";

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* 헤더 */}
        <div className="text-center space-y-2">
          <div className="flex size-12 items-center justify-center rounded-xl bg-brand/10 mx-auto">
            <FileSignature className="size-6 text-brand" />
          </div>
          <p className="text-xs text-muted-foreground font-medium tracking-wide uppercase">153 Boxing Gym</p>
          <h1 className="text-xl font-bold text-foreground">{contract.title}</h1>
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {CONTRACT_TYPE_LABELS[contract.contract_type] ?? contract.contract_type}
            </span>
            <span className={`flex items-center gap-1 text-xs font-semibold ${statusInfo.color}`}>
              <StatusIcon className="size-3.5" />
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* 기본 정보 */}
        <div className="bg-white rounded-xl border border-border p-5 grid grid-cols-2 gap-4 text-sm">
          {contract.staff && (
            <>
              <div>
                <p className="text-xs text-muted-foreground">성명</p>
                <p className="font-semibold text-foreground mt-0.5">{contract.staff.name}</p>
              </div>
              {contract.staff.position && (
                <div>
                  <p className="text-xs text-muted-foreground">직책</p>
                  <p className="font-medium text-foreground mt-0.5">{contract.staff.position}</p>
                </div>
              )}
            </>
          )}
          {contract.valid_from && (
            <div>
              <p className="text-xs text-muted-foreground">계약 시작일</p>
              <p className="font-medium text-foreground mt-0.5">{contract.valid_from}</p>
            </div>
          )}
          {contract.valid_until && (
            <div>
              <p className="text-xs text-muted-foreground">계약 종료일</p>
              <p className="font-medium text-foreground mt-0.5">{contract.valid_until}</p>
            </div>
          )}
          {contract.sent_at && (
            <div>
              <p className="text-xs text-muted-foreground">발송일</p>
              <p className="font-medium text-foreground mt-0.5">{contract.sent_at.slice(0, 10)}</p>
            </div>
          )}
          {contract.signed_at && (
            <div>
              <p className="text-xs text-muted-foreground">서명일</p>
              <p className="font-medium text-success mt-0.5">{contract.signed_at.slice(0, 10)}</p>
            </div>
          )}
        </div>

        {/* 계약서 본문 */}
        {contractBody ? (
          <div className="bg-white rounded-xl border border-border p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">계약서 본문</p>
            <pre className="text-sm text-foreground leading-relaxed whitespace-pre-wrap font-sans break-words">
              {contractBody}
            </pre>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-border p-6 text-center text-muted-foreground text-sm">
            계약서 본문이 없습니다. 담당자에게 문의해 주세요.
          </div>
        )}

        {/* 안내 문구 */}
        <div className="text-center text-xs text-muted-foreground space-y-1 pb-8">
          <p>본 계약서는 153복싱짐 운영 시스템을 통해 발송되었습니다.</p>
          <p>내용 확인 후 담당자에게 서명 의사를 알려주세요.</p>
        </div>
      </div>
    </div>
  );
}

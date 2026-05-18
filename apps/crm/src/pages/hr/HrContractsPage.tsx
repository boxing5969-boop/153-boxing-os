/**
 * HR — 지점 전체 계약서 목록
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileSignature, Search, Eye, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  listStaff, listContracts,
  CONTRACT_TYPE_LABELS, CONTRACT_STATUS_LABELS,
  type Staff, type StaffContract,
} from "@/services/hr";
import { cn } from "@/lib/cn";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-50 text-blue-700",
  signed: "bg-success/10 text-success",
  expired: "bg-warning/10 text-warning",
  canceled: "bg-danger/10 text-danger",
};

interface StaffWithContracts extends Staff {
  contracts: StaffContract[];
}

export default function HrContractsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const branchId = profile?.branch_id ?? "";
  const [search, setSearch] = useState("");

  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ["hr-staff", branchId],
    queryFn: () => listStaff(branchId),
    enabled: !!branchId,
  });

  const staffIds = staffList.map(s => s.id);

  // 각 직원의 계약서를 병렬로 로드
  const contractQueries = useQuery({
    queryKey: ["hr-all-contracts", staffIds],
    queryFn: async () => {
      const results = await Promise.all(staffIds.map(id => listContracts(id)));
      return staffIds.reduce<Record<string, StaffContract[]>>((acc, id, i) => {
        acc[id] = results[i] ?? [];
        return acc;
      }, {});
    },
    enabled: staffIds.length > 0,
  });

  const contractsByStaff = contractQueries.data ?? {};

  const staffWithContracts: StaffWithContracts[] = staffList.map(s => ({
    ...s,
    contracts: contractsByStaff[s.id] ?? [],
  }));

  const filtered = staffWithContracts.filter(s =>
    s.contracts.length > 0 &&
    (s.name.includes(search) || s.contracts.some(c => c.title.includes(search)))
  );

  const allContracts = staffWithContracts.flatMap(s => s.contracts.map(c => ({ ...c, staffName: s.name, staffId: s.id })));
  const stats = {
    total: allContracts.length,
    draft: allContracts.filter(c => c.status === "draft").length,
    sent: allContracts.filter(c => c.status === "sent").length,
    signed: allContracts.filter(c => c.status === "signed").length,
  };

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10">
            <FileSignature className="size-5 text-brand" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">계약서</h1>
            <p className="text-xs text-muted-foreground">직원별 계약서 발행 및 현황 관리</p>
          </div>
        </div>

        {/* 통계 */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "전체", count: stats.total, color: "text-foreground" },
            { label: "초안", count: stats.draft, color: "text-muted-foreground" },
            { label: "발송됨", count: stats.sent, color: "text-blue-600" },
            { label: "서명완료", count: stats.signed, color: "text-success" },
          ].map(({ label, count, color }) => (
            <Card key={label} className="px-4 py-3 text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn("text-2xl font-bold", color)}>{count}</p>
            </Card>
          ))}
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="직원명, 계약서 제목 검색" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* 계약서 목록 */}
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground text-sm">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <Card className="py-14 flex flex-col items-center gap-3 text-muted-foreground">
            <FileSignature className="size-9 opacity-30" />
            <p className="text-sm">계약서가 없습니다. 직원 상세에서 계약서를 작성하세요.</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/hr/staff")}>직원 관리로 이동</Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map(s => (
              <div key={s.id}>
                <div
                  className="flex items-center gap-2 mb-2 cursor-pointer hover:text-brand transition-colors"
                  onClick={() => navigate(`/hr/staff/${s.id}`)}
                >
                  <div className="size-6 rounded-full bg-brand/10 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-brand">{s.name.slice(0, 1)}</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{s.name}</span>
                  <ExternalLink className="size-3 text-muted-foreground" />
                </div>
                <div className="space-y-2 pl-8">
                  {s.contracts.map(c => (
                    <Card key={c.id} className="px-4 py-3 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">{c.title}</span>
                          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", STATUS_COLORS[c.status])}>
                            {CONTRACT_STATUS_LABELS[c.status]}
                          </span>
                          <span className="text-xs text-muted-foreground">{CONTRACT_TYPE_LABELS[c.contract_type]}</span>
                        </div>
                        <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                          {c.valid_from && <span>시작: {c.valid_from}</span>}
                          {c.valid_until && <span>종료: {c.valid_until}</span>}
                          {c.sent_at && <span>발송: {c.sent_at.slice(0, 10)}</span>}
                        </div>
                      </div>
                      {c.file_url && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={c.file_url} target="_blank" rel="noreferrer">
                            <Eye className="size-3.5 mr-1" />보기
                          </a>
                        </Button>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

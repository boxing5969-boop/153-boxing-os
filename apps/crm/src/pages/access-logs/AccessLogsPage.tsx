import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ACCESS_RESULT_VALUES,
  AccessResultBadge,
  CREDENTIAL_TYPE_VALUES,
  accessResultLabel,
  credentialLabel,
} from "@/components/access/AccessResultBadge";
import { listAccessLogs } from "@/services/accessLogs";
import { formatDateTime } from "@/lib/format";
import { DENIED_REASON_LABELS, type AccessResult, type CredentialType } from "@153/shared";

const PAGE_SIZE = 20;

export default function AccessLogsPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<"" | AccessResult>("");
  const [credential, setCredential] = useState<"" | CredentialType>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const filters = useMemo(
    () => ({
      result: result || null,
      credential_type: credential || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [result, credential, from, to, page]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["access-logs", filters],
    queryFn: () => listAccessLogs(filters),
    staleTime: 5_000,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  function resetFilters() {
    setResult("");
    setCredential("");
    setFrom("");
    setTo("");
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="출입로그" description="필터로 좁혀보세요. 회원 클릭 시 상세로 이동." />

      <Card className="p-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Select
            value={result}
            onChange={(e) => {
              setResult(e.target.value as AccessResult | "");
              setPage(0);
            }}
          >
            <option value="">결과 전체</option>
            {ACCESS_RESULT_VALUES.map((r) => (
              <option key={r} value={r}>
                {accessResultLabel(r)}
              </option>
            ))}
          </Select>
          <Select
            value={credential}
            onChange={(e) => {
              setCredential(e.target.value as CredentialType | "");
              setPage(0);
            }}
          >
            <option value="">자격 전체</option>
            {CREDENTIAL_TYPE_VALUES.map((c) => (
              <option key={c} value={c}>
                {credentialLabel(c)}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
            placeholder="시작"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
            placeholder="종료"
          />
          <Button variant="outline" onClick={resetFilters}>
            필터 초기화
          </Button>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">시각</th>
              <th className="px-4 py-3">결과</th>
              <th className="px-4 py-3">자격</th>
              <th className="px-4 py-3">회원</th>
              <th className="px-4 py-3">단말기</th>
              <th className="px-4 py-3">사유</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-red-600">
                  오류: {error instanceof Error ? error.message : "알 수 없는 오류"}
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center opacity-60">
                  로그가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-foreground/5 ${r.member_id ? "hover:bg-foreground/5 cursor-pointer" : ""}`}
                onClick={() => {
                  if (r.member_id) navigate(`/members/${r.member_id}`);
                }}
              >
                <td className="px-4 py-3 opacity-80">{formatDateTime(r.occurred_at)}</td>
                <td className="px-4 py-3">
                  <AccessResultBadge result={r.result} />
                </td>
                <td className="px-4 py-3 opacity-80">{credentialLabel(r.credential_type)}</td>
                <td className="px-4 py-3 font-medium">
                  {r.member_name ?? (r.member_id ? "—" : "익명")}
                </td>
                <td className="px-4 py-3 opacity-80">{r.device_name ?? "—"}</td>
                <td className="px-4 py-3 opacity-70">
                  {r.denied_reason ? DENIED_REASON_LABELS[r.denied_reason] : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="opacity-70">총 {total}건</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            이전
          </Button>
          <span className="px-2 opacity-70">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      </div>
    </div>
  );
}

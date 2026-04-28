import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Key } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
  DeviceStatusBadge,
  deviceTypeLabel,
  deviceVendorLabel,
} from "@/components/devices/DeviceStatusBadge";
import {
  AccessResultBadge,
  credentialLabel,
} from "@/components/access/AccessResultBadge";
import { getDeviceDetail } from "@/services/deviceDetail";
import { forceDeviceSync } from "@/services/devices";
import { rotateDeviceKey, type DeviceKeyResult } from "@/services/devicesAdmin";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DENIED_REASON_LABELS, type DeniedReason, type SyncJobStatus } from "@153/shared";

const SYNC_STATUS_STYLES: Record<SyncJobStatus, string> = {
  pending: "bg-blue-100 text-blue-800",
  processing: "bg-blue-100 text-blue-800",
  success: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
};

const SYNC_STATUS_LABELS: Record<SyncJobStatus, string> = {
  pending: "대기",
  processing: "처리중",
  success: "성공",
  failed: "실패",
};

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const deviceId = id ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [rotatedKey, setRotatedKey] = useState<DeviceKeyResult | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["device-detail", deviceId],
    queryFn: () => getDeviceDetail(deviceId),
    enabled: !!deviceId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const forceSyncMutation = useMutation({
    mutationFn: forceDeviceSync,
    onSuccess: (res) => {
      setActionMsg(
        `강제 동기화 요청됨 — ${res.jobs_created}건 생성, 실패 ${res.failed_reset}건 재시도`
      );
      void qc.invalidateQueries({ queryKey: ["device-detail", deviceId] });
    },
    onError: (err) => {
      setActionMsg(`동기화 실패: ${errorMessage(err)}`);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: rotateDeviceKey,
    onSuccess: (r) => {
      setRotatedKey(r);
      void qc.invalidateQueries({ queryKey: ["device-detail", deviceId] });
    },
    onError: (err) => {
      setActionMsg(`키 회전 실패: ${errorMessage(err)}`);
    },
  });

  if (isLoading) return <p className="text-sm opacity-60">로딩 중…</p>;
  if (isError) {
    return (
      <p className="text-sm text-red-600">
        오류: {errorMessage(error)}
      </p>
    );
  }
  if (!data?.device) {
    return (
      <PageHeader
        title="장비를 찾을 수 없습니다"
        action={
          <Link to="/devices">
            <Button variant="outline">
              <ArrowLeft className="size-4" />
              목록으로
            </Button>
          </Link>
        }
      />
    );
  }

  const d = data.device;
  const recentLogs = data.recent_logs;
  const syncJobs = data.recent_sync_jobs;
  const failedJobs = syncJobs.filter((j) => j.status === "failed");
  const pendingJobs = syncJobs.filter((j) => j.status === "pending" || j.status === "processing");

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.device_name}
        description={
          <span className="flex items-center gap-2">
            <DeviceStatusBadge status={d.status} />
            <span className="opacity-60">
              {d.branch_name ?? "지점 미지정"} · {deviceTypeLabel(d.device_type)} ·{" "}
              {deviceVendorLabel(d.vendor)}
            </span>
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/devices")}>
              <ArrowLeft className="size-4" />
              목록으로
            </Button>
            <Button
              variant="outline"
              disabled={forceSyncMutation.isPending}
              onClick={() => forceSyncMutation.mutate(d.id)}
            >
              <RefreshCw className="size-4" />
              강제 동기화
            </Button>
            <Button
              variant="ghost"
              disabled={rotateMutation.isPending}
              onClick={() => {
                if (window.confirm("기존 키를 즉시 무효화합니다. 계속할까요?")) {
                  rotateMutation.mutate(d.id);
                }
              }}
            >
              <Key className="size-4" />
              키 회전
            </Button>
          </div>
        }
      />

      {actionMsg && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{actionMsg}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold opacity-80">기본 정보</h2>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="opacity-60">시리얼</dt>
              <dd className="col-span-2 break-all">{d.device_identifier ?? "—"}</dd>
              <dt className="opacity-60">모델</dt>
              <dd className="col-span-2">{d.model_name ?? "—"}</dd>
              <dt className="opacity-60">API URL</dt>
              <dd className="col-span-2 break-all opacity-80">{d.api_endpoint ?? "—"}</dd>
              <dt className="opacity-60">키 지문</dt>
              <dd className="col-span-2 font-mono text-xs">
                {d.api_key_fingerprint ?? "—"}
              </dd>
              <dt className="opacity-60">마지막 통신</dt>
              <dd className="col-span-2 opacity-80">
                {d.last_seen_at ? formatDateTime(d.last_seen_at) : "—"}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold opacity-80">동기화 상태</h2>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="opacity-60">대기 작업</dt>
              <dd className="col-span-2">{pendingJobs.length}건</dd>
              <dt className="opacity-60">실패 잔존</dt>
              <dd className={cn("col-span-2", failedJobs.length > 0 && "text-red-600")}>
                {failedJobs.length}건
              </dd>
              <dt className="opacity-60">최근 50건 성공률</dt>
              <dd className="col-span-2">
                {syncJobs.length === 0
                  ? "—"
                  : `${Math.round(
                      (syncJobs.filter((j) => j.status === "success").length /
                        syncJobs.length) *
                        100
                    )}%`}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold opacity-80">출입 이력 (최근 20건)</h2>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <p className="text-sm opacity-60">출입 이력이 없습니다.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="opacity-60">성공</dt>
                <dd className="text-green-700">
                  {recentLogs.filter((l) => l.result === "success").length}건
                </dd>
                <dt className="opacity-60">거절</dt>
                <dd className="text-red-700">
                  {recentLogs.filter((l) => l.result === "denied").length}건
                </dd>
                <dt className="opacity-60">오류</dt>
                <dd className="text-orange-700">
                  {recentLogs.filter((l) => l.result === "error").length}건
                </dd>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold opacity-80">동기화 작업 (최근 50건)</h2>
        </CardHeader>
        <CardContent className="p-0">
          {syncJobs.length === 0 ? (
            <p className="px-4 py-6 text-sm opacity-60">작업 이력이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
                <tr>
                  <th className="px-4 py-2">상태</th>
                  <th className="px-4 py-2">유형</th>
                  <th className="px-4 py-2">대상 회원</th>
                  <th className="px-4 py-2">재시도</th>
                  <th className="px-4 py-2">생성</th>
                  <th className="px-4 py-2">처리</th>
                  <th className="px-4 py-2">에러</th>
                </tr>
              </thead>
              <tbody>
                {syncJobs.map((j) => (
                  <tr key={j.id} className="border-b border-foreground/5">
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          SYNC_STATUS_STYLES[j.status]
                        )}
                      >
                        {SYNC_STATUS_LABELS[j.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 opacity-80">{j.job_type}</td>
                    <td className="px-4 py-2 opacity-80">
                      {j.target_member_id ? (
                        <Link
                          className="underline opacity-90 hover:opacity-100"
                          to={`/members/${j.target_member_id}`}
                        >
                          {j.target_member_id.slice(0, 8)}…
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2">{j.retry_count}</td>
                    <td className="px-4 py-2 opacity-70">{formatDateTime(j.created_at)}</td>
                    <td className="px-4 py-2 opacity-70">
                      {j.processed_at ? formatDateTime(j.processed_at) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-red-600 max-w-xs truncate">
                      {j.error_message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold opacity-80">최근 출입 (20건)</h2>
        </CardHeader>
        <CardContent className="p-0">
          {recentLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm opacity-60">출입 이력이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
                <tr>
                  <th className="px-4 py-2">시각</th>
                  <th className="px-4 py-2">결과</th>
                  <th className="px-4 py-2">자격</th>
                  <th className="px-4 py-2">회원</th>
                  <th className="px-4 py-2">사유</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((l) => (
                  <tr key={l.id} className="border-b border-foreground/5">
                    <td className="px-4 py-2 opacity-80">{formatDateTime(l.occurred_at)}</td>
                    <td className="px-4 py-2">
                      <AccessResultBadge result={l.result} />
                    </td>
                    <td className="px-4 py-2 opacity-80">
                      {credentialLabel(l.credential_type)}
                    </td>
                    <td className="px-4 py-2 opacity-80">
                      {l.member_id ? (
                        <Link
                          className="underline opacity-90 hover:opacity-100"
                          to={`/members/${l.member_id}`}
                        >
                          {l.member_id.slice(0, 8)}…
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 opacity-70">
                      {l.denied_reason
                        ? (DENIED_REASON_LABELS[l.denied_reason as DeniedReason] ??
                          l.denied_reason)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!rotatedKey}
        onClose={() => setRotatedKey(null)}
        title="새 api_key — 1회 노출"
        className="max-w-lg"
      >
        {rotatedKey && (
          <div className="space-y-4">
            <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              이 키는 다시 조회할 수 없습니다. 단말기 측에 즉시 입력하세요.
            </p>
            <code className="block break-all rounded-md border border-foreground/20 bg-muted px-3 py-2 text-xs font-mono">
              {rotatedKey.api_key}
            </code>
            <p className="text-xs opacity-70">
              지문: <code>{rotatedKey.api_key_fingerprint}</code>
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setRotatedKey(null)}>확인</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

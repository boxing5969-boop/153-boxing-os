import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  DEVICE_STATUS_VALUES,
  DeviceStatusBadge,
  deviceStatusLabel,
  deviceTypeLabel,
  deviceVendorLabel,
} from "@/components/devices/DeviceStatusBadge";
import { forceDeviceSync, getDevicePendingCount, listDevices } from "@/services/devices";
import { formatDateTime } from "@/lib/format";
import type { DeviceStatus } from "@153/shared";

export default function DevicesListPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"" | DeviceStatus>("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const filters = useMemo(() => ({ status: statusFilter || null }), [statusFilter]);

  const devicesQuery = useQuery({
    queryKey: ["devices", filters],
    queryFn: () => listDevices(filters),
    staleTime: 30_000,
  });

  const deviceIds = (devicesQuery.data ?? []).map((d) => d.id);
  const pendingQuery = useQuery({
    queryKey: ["devices-pending", deviceIds.sort().join(",")],
    queryFn: () => getDevicePendingCount(deviceIds),
    enabled: deviceIds.length > 0,
    staleTime: 30_000,
  });

  const pendingMap = pendingQuery.data ?? {};

  const forceSyncMutation = useMutation({
    mutationFn: forceDeviceSync,
    onSuccess: (res) => {
      setActionMessage(
        `강제 동기화 요청됨 — ${res.jobs_created}건 생성, 실패 ${res.failed_reset}건 재시도`
      );
      void qc.invalidateQueries({ queryKey: ["devices"] });
      void qc.invalidateQueries({ queryKey: ["devices-pending"] });
    },
    onError: (err) => {
      setActionMessage(
        `강제 동기화 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="장비"
        description="단말기 목록 + 상태 + 마지막 통신. 강제 동기화 클릭 시 Workers cron 이 1분 내 처리."
      />

      {actionMessage && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{actionMessage}</p>
      )}

      <Card className="p-4">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DeviceStatus | "")}
          className="max-w-xs"
        >
          <option value="">상태 전체</option>
          {DEVICE_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {deviceStatusLabel(s)}
            </option>
          ))}
        </Select>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">장비명</th>
              <th className="px-4 py-3">지점</th>
              <th className="px-4 py-3">종류</th>
              <th className="px-4 py-3">벤더</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">대기 작업</th>
              <th className="px-4 py-3">마지막 통신</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {devicesQuery.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {devicesQuery.isError && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-red-600">
                  오류:{" "}
                  {devicesQuery.error instanceof Error
                    ? devicesQuery.error.message
                    : "알 수 없는 오류"}
                </td>
              </tr>
            )}
            {!devicesQuery.isLoading &&
              !devicesQuery.isError &&
              (devicesQuery.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center opacity-60">
                    등록된 장비가 없습니다.
                  </td>
                </tr>
              )}
            {(devicesQuery.data ?? []).map((d) => {
              const pending = pendingMap[d.id] ?? 0;
              return (
                <tr key={d.id} className="border-b border-foreground/5">
                  <td className="px-4 py-3 font-medium">{d.device_name}</td>
                  <td className="px-4 py-3 opacity-80">{d.branch_name ?? "—"}</td>
                  <td className="px-4 py-3 opacity-80">{deviceTypeLabel(d.device_type)}</td>
                  <td className="px-4 py-3 opacity-80">{deviceVendorLabel(d.vendor)}</td>
                  <td className="px-4 py-3">
                    <DeviceStatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3">
                    {pending > 0 ? (
                      <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                        {pending}
                      </span>
                    ) : (
                      <span className="opacity-60">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 opacity-70">
                    {d.last_seen_at ? formatDateTime(d.last_seen_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={forceSyncMutation.isPending}
                      onClick={() => {
                        setActionMessage(null);
                        forceSyncMutation.mutate(d.id);
                      }}
                    >
                      <RefreshCw className="size-3" />
                      강제 동기화
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

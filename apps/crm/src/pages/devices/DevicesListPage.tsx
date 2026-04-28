import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Key } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DEVICE_STATUS_VALUES,
  DeviceStatusBadge,
  deviceStatusLabel,
  deviceTypeLabel,
  deviceVendorLabel,
} from "@/components/devices/DeviceStatusBadge";
import { NewDeviceDialog } from "@/components/devices/NewDeviceDialog";
import { forceDeviceSync, getDevicePendingCount, listDevices } from "@/services/devices";
import { rotateDeviceKey, type DeviceKeyResult } from "@/services/devicesAdmin";
import { formatDateTime } from "@/lib/format";
import type { DeviceStatus } from "@153/shared";

export default function DevicesListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<"" | DeviceStatus>("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [rotateConfirmId, setRotateConfirmId] = useState<string | null>(null);
  const [rotatedKey, setRotatedKey] = useState<DeviceKeyResult | null>(null);

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
        `강제 동기화 실패: ${errorMessage(err)}`
      );
    },
  });

  const rotateMutation = useMutation({
    mutationFn: rotateDeviceKey,
    onSuccess: (r) => {
      setRotateConfirmId(null);
      setRotatedKey(r);
      void qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (err) => {
      setActionMessage(`키 회전 실패: ${errorMessage(err)}`);
      setRotateConfirmId(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="장비"
        description="단말기 목록 + 상태. 등록 시 발급된 api_key 는 1회만 노출되니 즉시 단말기 측에 입력하세요."
        action={
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="size-4" />
            장비 등록
          </Button>
        }
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
              <th className="px-4 py-3">대기</th>
              <th className="px-4 py-3">키 지문</th>
              <th className="px-4 py-3">마지막 통신</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {devicesQuery.isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {devicesQuery.isError && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-red-600">
                  오류:{" "}
                  {errorMessage(devicesQuery.error)}
                </td>
              </tr>
            )}
            {!devicesQuery.isLoading &&
              !devicesQuery.isError &&
              (devicesQuery.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center opacity-60">
                    등록된 장비가 없습니다. 우상단 "장비 등록" 으로 시작하세요.
                  </td>
                </tr>
              )}
            {(devicesQuery.data ?? []).map((d) => {
              const pending = pendingMap[d.id] ?? 0;
              const fingerprint = (d as { api_key_fingerprint?: string | null }).api_key_fingerprint;
              return (
                <tr
                  key={d.id}
                  className="border-b border-foreground/5 hover:bg-foreground/5 cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    navigate(`/devices/${d.id}`);
                  }}
                >
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
                  <td className="px-4 py-3 font-mono text-xs opacity-70">
                    {fingerprint ?? "—"}
                  </td>
                  <td className="px-4 py-3 opacity-70">
                    {d.last_seen_at ? formatDateTime(d.last_seen_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
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
                      동기화
                    </Button>{" "}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRotateConfirmId(d.id)}
                    >
                      <Key className="size-3" />
                      키 회전
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <NewDeviceDialog open={openNew} onClose={() => setOpenNew(false)} />

      <Dialog
        open={!!rotateConfirmId}
        onClose={() => setRotateConfirmId(null)}
        title="키 회전"
      >
        <p className="text-sm">
          기존 api_key 가 즉시 무효화됩니다. 새 키를 단말기에 입력하기 전엔 출입
          판단이 실패합니다. 계속할까요?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setRotateConfirmId(null)}
            disabled={rotateMutation.isPending}
          >
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={() => rotateConfirmId && rotateMutation.mutate(rotateConfirmId)}
            disabled={rotateMutation.isPending}
          >
            {rotateMutation.isPending ? "발급 중…" : "키 회전"}
          </Button>
        </div>
      </Dialog>

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

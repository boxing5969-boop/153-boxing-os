import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Key, SlidersHorizontal, Cpu, ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
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
          <Button onClick={() => setOpenNew(true)} className="gap-2 rounded-full">
            <Plus className="size-4" />
            장비 등록
          </Button>
        }
      />

      {actionMessage && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary shadow-card">
          {actionMessage}
        </div>
      )}

      {/* 필터 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as DeviceStatus | "")}
            className="min-w-[150px] max-w-xs border-0 bg-transparent px-1 shadow-none focus:ring-0"
          >
            <option value="">상태 전체</option>
            {DEVICE_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {deviceStatusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* 장비 리스트 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {devicesQuery.isLoading && (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">로딩 중…</div>
        )}
        {devicesQuery.isError && (
          <div className="px-5 py-16 text-center text-sm text-danger">
            오류: {errorMessage(devicesQuery.error)}
          </div>
        )}
        {!devicesQuery.isLoading && !devicesQuery.isError && (devicesQuery.data?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <Cpu className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">등록된 장비가 없습니다</p>
            <p className="text-xs text-muted-foreground">
              우상단 "장비 등록"으로 시작하세요
            </p>
          </div>
        )}
        {!devicesQuery.isLoading && !devicesQuery.isError && (devicesQuery.data?.length ?? 0) > 0 && (
          <ul className="divide-y divide-border/60">
            {(devicesQuery.data ?? []).map((d) => {
              const pending = pendingMap[d.id] ?? 0;
              const fingerprint = (d as { api_key_fingerprint?: string | null }).api_key_fingerprint;
              return (
                <li
                  key={d.id}
                  className="group flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    navigate(`/devices/${d.id}`);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-foreground">{d.device_name}</span>
                      <DeviceStatusBadge status={d.status} />
                      {pending > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                          <span className="size-1.5 rounded-full bg-warning" />
                          대기 {pending}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{d.branch_name ?? "—"}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{deviceTypeLabel(d.device_type)}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{deviceVendorLabel(d.vendor)}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="tabular">
                        {d.last_seen_at ? formatDateTime(d.last_seen_at) : "통신 없음"}
                      </span>
                      {fingerprint && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="font-mono">{fingerprint}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 rounded-full px-3 text-xs"
                      disabled={forceSyncMutation.isPending}
                      onClick={() => {
                        setActionMessage(null);
                        forceSyncMutation.mutate(d.id);
                      }}
                    >
                      <RefreshCw className="size-3" />
                      동기화
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 rounded-full px-3 text-xs"
                      onClick={() => setRotateConfirmId(d.id)}
                    >
                      <Key className="size-3" />
                      키 회전
                    </Button>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
            <p className="rounded-2xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning">
              이 키는 다시 조회할 수 없습니다. 단말기 측에 즉시 입력하세요.
            </p>
            <code className="block break-all rounded-xl border border-border bg-muted px-3 py-2.5 font-mono text-xs">
              {rotatedKey.api_key}
            </code>
            <p className="text-xs text-muted-foreground">
              지문: <code className="font-mono">{rotatedKey.api_key_fingerprint}</code>
            </p>
            <div className="flex justify-end">
              <Button className="rounded-full" onClick={() => setRotatedKey(null)}>확인</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

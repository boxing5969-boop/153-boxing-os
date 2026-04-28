import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirmDialog";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import {
  listMemberConsents,
  recordMemberConsent,
  revokeMemberConsent,
} from "@/services/consents";
import {
  CONSENT_TYPE_DESCRIPTIONS,
  CONSENT_TYPE_LABELS,
  CONSENT_TYPE_VALUES,
  type ConsentRecord,
  type ConsentType,
} from "@153/shared";

interface Props {
  memberId: string;
}

interface PendingAction {
  type: "revoke" | "grant";
  consentType: ConsentType;
}

export function ConsentManagementCard({ memberId }: Props) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const consentsQuery = useQuery({
    queryKey: ["consents", memberId],
    queryFn: () => listMemberConsents(memberId),
    enabled: !!memberId,
  });

  // 각 consent_type 별 가장 최근 활성 여부 + 가장 최근 row
  const summary = useMemo(() => {
    const map = new Map<ConsentType, { active: ConsentRecord | null; latest: ConsentRecord | null }>();
    for (const t of CONSENT_TYPE_VALUES) map.set(t, { active: null, latest: null });
    for (const r of consentsQuery.data ?? []) {
      const slot = map.get(r.consent_type);
      if (!slot) continue;
      if (!slot.latest) slot.latest = r;
      if (!slot.active && r.is_active) slot.active = r;
    }
    return map;
  }, [consentsQuery.data]);

  const revokeMutation = useMutation({
    mutationFn: ({ consentType }: { consentType: ConsentType }) =>
      revokeMemberConsent(memberId, consentType),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["consents", memberId] });
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      const jobInfo = res.sync_jobs_created
        ? ` — 단말기 ${res.sync_jobs_created}대에서 삭제 작업 자동 생성됨`
        : "";
      setActionMsg(
        `${CONSENT_TYPE_LABELS[res.consent_type]} 동의가 철회됐습니다${jobInfo}.`
      );
      setPending(null);
    },
    onError: (err) => {
      setActionMsg(`철회 실패: ${errorMessage(err)}`);
      setPending(null);
    },
  });

  const grantMutation = useMutation({
    mutationFn: ({ consentType }: { consentType: ConsentType }) =>
      recordMemberConsent(memberId, consentType),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["consents", memberId] });
      setActionMsg(`${CONSENT_TYPE_LABELS[res.consent_type]} 동의가 기록됐습니다.`);
      setPending(null);
    },
    onError: (err) => {
      setActionMsg(`기록 실패: ${errorMessage(err)}`);
      setPending(null);
    },
  });

  const isMutating = revokeMutation.isPending || grantMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold opacity-80">동의 관리</h2>
          <p className="text-xs opacity-60 mt-0.5">
            얼굴인식 철회 시 등록된 모든 단말기에서 자동 삭제됩니다.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {actionMsg && (
          <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
            {actionMsg}
          </p>
        )}
        {consentsQuery.isLoading && (
          <p className="text-sm opacity-60">로딩 중…</p>
        )}
        {consentsQuery.isError && (
          <p className="text-sm text-red-600">
            오류:{" "}
            {errorMessage(consentsQuery.error)}
          </p>
        )}
        {!consentsQuery.isLoading && !consentsQuery.isError && (
          <ul className="divide-y divide-foreground/5">
            {CONSENT_TYPE_VALUES.map((t) => {
              const slot = summary.get(t);
              const active = slot?.active ?? null;
              const latest = slot?.latest ?? null;
              return (
                <li key={t} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {CONSENT_TYPE_LABELS[t]}
                      </span>
                      <StatusPill active={!!active} />
                    </div>
                    <p className="mt-1 text-xs opacity-70">
                      {CONSENT_TYPE_DESCRIPTIONS[t]}
                    </p>
                    {latest && (
                      <p className="mt-1 text-xs opacity-60">
                        마지막 변경: {formatDateTime(latest.agreed_at)}
                        {latest.revoked_at && ` · 철회됨 ${formatDateTime(latest.revoked_at)}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {active ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isMutating}
                        onClick={() => {
                          setActionMsg(null);
                          setPending({ type: "revoke", consentType: t });
                        }}
                      >
                        <X className="size-3" />
                        철회
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isMutating}
                        onClick={() => {
                          setActionMsg(null);
                          setPending({ type: "grant", consentType: t });
                        }}
                      >
                        <Check className="size-3" />
                        동의 받음
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!pending}
        onClose={() => {
          if (!isMutating) setPending(null);
        }}
        title={
          pending?.type === "revoke"
            ? `${CONSENT_TYPE_LABELS[pending.consentType]} 동의 철회`
            : pending
              ? `${CONSENT_TYPE_LABELS[pending.consentType]} 동의 기록`
              : ""
        }
        description={
          pending?.type === "revoke" ? (
            <span className="space-y-2 block">
              <span className="block">
                <strong>{CONSENT_TYPE_LABELS[pending.consentType]}</strong> 동의를 철회합니다.
              </span>
              {pending.consentType === "face_recognition" && (
                <span className="flex gap-2 mt-2 rounded-md bg-yellow-50 px-3 py-2 text-yellow-800">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>
                    철회 즉시 모든 등록 단말기에서 사용자 영구 삭제 작업이 큐잉됩니다.
                    Workers cron 이 1분 내 처리합니다.
                  </span>
                </span>
              )}
            </span>
          ) : pending ? (
            <span>
              <strong>{CONSENT_TYPE_LABELS[pending.consentType]}</strong> 동의를 받았음을
              기록합니다. 회원 본인의 의사를 확인했나요?
            </span>
          ) : (
            ""
          )
        }
        confirmLabel={pending?.type === "revoke" ? "철회" : "동의 기록"}
        variant={pending?.type === "revoke" ? "destructive" : "default"}
        onConfirm={() => {
          if (!pending) return;
          if (pending.type === "revoke") {
            revokeMutation.mutate({ consentType: pending.consentType });
          } else {
            grantMutation.mutate({ consentType: pending.consentType });
          }
        }}
        pending={isMutating}
      />
    </Card>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"
      )}
    >
      {active ? "동의" : "미동의"}
    </span>
  );
}

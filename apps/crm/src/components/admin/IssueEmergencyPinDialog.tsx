import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { listBranches } from "@/services/lookups";
import {
  issueEmergencyPin,
  type IssueEmergencyPinResult,
} from "@/services/emergencyPins";
import { formatDateTime } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

export function IssueEmergencyPinDialog({ open, onClose }: Props) {
  if (!open) return null;
  return <IssueEmergencyPinDialogBody onClose={onClose} />;
}

function IssueEmergencyPinDialogBody({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isHq = profile ? HQ_ROLES.has(profile.role) : false;

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: isHq,
    staleTime: 60_000,
  });

  const [step, setStep] = useState<"form" | "result">("form");
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const [purpose, setPurpose] = useState("");
  const [ttl, setTtl] = useState(10);
  const [maxUses, setMaxUses] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IssueEmergencyPinResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const mutation = useMutation({
    mutationFn: issueEmergencyPin,
    onSuccess: (r) => {
      setResult(r);
      setStep("result");
      void qc.invalidateQueries({ queryKey: ["emergency-pins"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "발급 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!branchId) {
      setError("지점을 선택하세요");
      return;
    }
    mutation.mutate({
      branch_id: branchId,
      purpose: purpose.trim() || undefined,
      ttl_minutes: ttl,
      max_uses: maxUses,
    });
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  function handleClose() {
    if (step === "result" && !acknowledged) {
      const ok = window.confirm("PIN 을 안전하게 전달했는지 확인하세요. 닫으면 다시 볼 수 없습니다.");
      if (!ok) return;
    }
    onClose();
  }

  return (
    <Dialog
      open={true}
      onClose={handleClose}
      title={step === "form" ? "비상 PIN 발급" : "PIN 발급 완료 — 1회 노출"}
      className="max-w-md"
    >
      {step === "form" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pbranch">지점 *</Label>
            {isHq ? (
              <Select
                id="pbranch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                disabled={branchesQuery.isLoading}
              >
                <option value="">선택하세요</option>
                {(branchesQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={profile?.branch_id ?? "—"} disabled />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ppurpose">사유 (선택, 감사 기록용)</Label>
            <Input
              id="ppurpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="단말기 점검 / 회원 본인확인 불가 등"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pttl">유효 시간 (분)</Label>
              <Input
                id="pttl"
                type="number"
                min={1}
                max={1440}
                value={ttl}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setTtl(v);
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="puses">최대 사용 횟수</Label>
              <Input
                id="puses"
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setMaxUses(v);
                }}
                required
              />
            </div>
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClose}>
              취소
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "발급 중…" : "PIN 발급"}
            </Button>
          </div>
        </form>
      )}

      {step === "result" && result && (
        <div className="space-y-4">
          <div className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              <strong>이 PIN 은 다시 조회할 수 없습니다.</strong> 즉시 단말기에 입력하거나
              본인에게 안전하게 전달하세요.
            </span>
          </div>
          <div className="space-y-2">
            <Label>PIN</Label>
            <div className="flex gap-2">
              <code className="flex-1 text-center rounded-md border border-foreground/20 bg-muted px-3 py-3 text-2xl font-mono font-bold tracking-widest">
                {result.pin}
              </code>
              <Button type="button" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "복사됨" : "복사"}
              </Button>
            </div>
          </div>
          <p className="text-xs opacity-70">
            만료: {formatDateTime(result.expires_at)} · 최대 {result.max_uses}회
          </p>
          <div className="flex items-center gap-2">
            <input
              id="pack"
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="size-4"
            />
            <label htmlFor="pack" className="text-sm">
              PIN 을 안전하게 전달·기록했음을 확인합니다.
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={!acknowledged} onClick={onClose}>
              완료
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { listBranches } from "@/services/lookups";
import {
  registerDevice,
  type DeviceKeyResult,
  type RegisterDeviceInput,
} from "@/services/devicesAdmin";

interface Props {
  open: boolean;
  onClose: () => void;
}

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

const TYPE_OPTIONS: { value: RegisterDeviceInput["device_type"]; label: string }[] = [
  { value: "face_terminal", label: "얼굴인식" },
  { value: "qr_reader", label: "QR 리더" },
  { value: "card_reader", label: "카드 리더" },
  { value: "relay", label: "릴레이" },
  { value: "kiosk", label: "키오스크" },
];

const VENDOR_OPTIONS: { value: RegisterDeviceInput["vendor"]; label: string }[] = [
  { value: "mock", label: "Mock (개발/QA)" },
  { value: "suprema", label: "Suprema" },
  { value: "zkteco", label: "ZKTeco" },
  { value: "hikvision", label: "Hikvision" },
  { value: "custom", label: "Custom" },
  { value: "other", label: "기타" },
];

export function NewDeviceDialog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isHq = profile ? HQ_ROLES.has(profile.role) : false;

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: open && isHq,
    staleTime: 60_000,
  });

  const [step, setStep] = useState<"form" | "result">("form");
  const [name, setName] = useState("");
  const [deviceType, setDeviceType] =
    useState<RegisterDeviceInput["device_type"]>("face_terminal");
  const [vendor, setVendor] = useState<RegisterDeviceInput["vendor"]>("mock");
  const [identifier, setIdentifier] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeviceKeyResult | null>(null);
  const [keyAcknowledged, setKeyAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setName("");
    setDeviceType("face_terminal");
    setVendor("mock");
    setIdentifier("");
    setModelName("");
    setApiEndpoint("");
    setBranchId(profile?.branch_id ?? "");
    setError(null);
    setResult(null);
    setKeyAcknowledged(false);
    setCopied(false);
  }, [open, profile?.branch_id]);

  const mutation = useMutation({
    mutationFn: registerDevice,
    onSuccess: (r) => {
      setResult(r);
      setStep("result");
      void qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "등록 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!branchId) {
      setError("지점을 선택하세요");
      return;
    }
    mutation.mutate({
      branch_id: branchId,
      device_name: name.trim(),
      device_type: deviceType,
      vendor,
      device_identifier: identifier.trim() || undefined,
      model_name: modelName.trim() || undefined,
      api_endpoint: apiEndpoint.trim() || undefined,
    });
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text element manually
    }
  }

  function handleClose() {
    if (step === "result" && !keyAcknowledged) {
      const proceed = window.confirm(
        "api_key 를 복사·저장했는지 확인해주세요. 닫으면 다시 볼 수 없습니다."
      );
      if (!proceed) return;
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={step === "form" ? "장비 등록" : "장비 등록 완료 — api_key 1회 노출"}
      className="max-w-lg"
    >
      {step === "form" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dname">장비 이름 *</Label>
              <Input
                id="dname"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="입구 얼굴인식기"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dtype">종류 *</Label>
              <Select
                id="dtype"
                value={deviceType}
                onChange={(e) =>
                  setDeviceType(e.target.value as RegisterDeviceInput["device_type"])
                }
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dvendor">벤더 *</Label>
              <Select
                id="dvendor"
                value={vendor}
                onChange={(e) =>
                  setVendor(e.target.value as RegisterDeviceInput["vendor"])
                }
              >
                {VENDOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dbranch">지점 *</Label>
              {isHq ? (
                <Select
                  id="dbranch"
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
              <Label htmlFor="didentifier">시리얼/식별자</Label>
              <Input
                id="didentifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="MOCK-GANGNAM-002"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dmodel">모델명</Label>
              <Input
                id="dmodel"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="FaceStation 2"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dendpoint">벤더 API URL (선택)</Label>
              <Input
                id="dendpoint"
                type="url"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                placeholder="https://biostar.example.com"
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
              {mutation.isPending ? "등록 중…" : "등록 + 키 발급"}
            </Button>
          </div>
        </form>
      )}

      {step === "result" && result && (
        <div className="space-y-4">
          <div className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              <strong>이 키는 다시 조회할 수 없습니다.</strong> 단말기 측에 즉시
              입력하고, 안전한 곳에 백업하세요. 분실 시 키 회전을 통해 새 키를
              발급해야 합니다.
            </span>
          </div>
          <div className="space-y-2">
            <Label>API Key (1회 노출)</Label>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-md border border-foreground/20 bg-muted px-3 py-2 text-xs font-mono">
                {result.api_key}
              </code>
              <Button type="button" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "복사됨" : "복사"}
              </Button>
            </div>
            <p className="text-xs opacity-70">
              지문: <code>{result.api_key_fingerprint}</code> — 이후 CRM 에선 이
              지문만 표시됩니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ack"
              type="checkbox"
              checked={keyAcknowledged}
              onChange={(e) => setKeyAcknowledged(e.target.checked)}
              className="size-4"
            />
            <label htmlFor="ack" className="text-sm">
              키를 안전하게 저장했음을 확인합니다.
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={!keyAcknowledged} onClick={onClose}>
              완료
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

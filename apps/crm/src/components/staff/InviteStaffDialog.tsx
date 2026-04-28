import { type FormEvent, useEffect, useMemo, useState } from "react";
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
  inviteStaff,
  type InviteStaffResult,
  type InviteStaffInput,
} from "@/services/staffApi";
import { roleLabel } from "@/lib/roleLabels";
import type { UserRole } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
}

const BRANCH_REQUIRED: UserRole[] = ["branch_owner", "branch_manager", "coach"];

export function InviteStaffDialog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";

  // 호출 가능한 역할 목록
  const ROLE_OPTIONS = useMemo<UserRole[]>(() => {
    const base: UserRole[] = ["hq_admin", "branch_owner", "branch_manager", "coach"];
    return isSuperAdmin ? (["super_admin", ...base] as UserRole[]) : base;
  }, [isSuperAdmin]);

  const [step, setStep] = useState<"form" | "result">("form");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("coach");
  const [branchId, setBranchId] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteStaffResult | null>(null);
  const [copiedField, setCopiedField] = useState<"email" | "password" | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setEmail("");
    setName("");
    setRole("coach");
    setBranchId("");
    setPhone("");
    setError(null);
    setResult(null);
    setAcknowledged(false);
    setCopiedField(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: inviteStaff,
    onSuccess: (r) => {
      setResult(r);
      setStep("result");
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "초대 실패"),
  });

  const branchRequired = BRANCH_REQUIRED.includes(role);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (branchRequired && !branchId) {
      setError("이 역할은 지점 지정이 필요합니다");
      return;
    }
    const input: InviteStaffInput = {
      email: email.trim(),
      name: name.trim(),
      role,
      branch_id: branchId || undefined,
      phone: phone.trim() || undefined,
    };
    mutation.mutate(input);
  }

  async function copy(text: string, field: "email" | "password") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // ignore
    }
  }

  function handleClose() {
    if (step === "result" && !acknowledged) {
      const proceed = window.confirm(
        "임시 비밀번호를 안전하게 전달했는지 확인하세요. 닫으면 다시 볼 수 없습니다."
      );
      if (!proceed) return;
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={step === "form" ? "직원 초대" : "초대 완료 — 임시 비밀번호 1회 노출"}
      className="max-w-lg"
    >
      {step === "form" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="iemail">이메일 *</Label>
              <Input
                id="iemail"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iname">이름 *</Label>
              <Input
                id="iname"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iphone">전화</Label>
              <Input
                id="iphone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-1234-5678"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="irole">역할 *</Label>
              <Select
                id="irole"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as UserRole);
                  if (!BRANCH_REQUIRED.includes(e.target.value as UserRole)) setBranchId("");
                }}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ibranch">지점{branchRequired && " *"}</Label>
              <Select
                id="ibranch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required={branchRequired}
                disabled={!branchRequired || branchesQuery.isLoading}
              >
                <option value="">{branchRequired ? "선택하세요" : "본사 (지점 없음)"}</option>
                {(branchesQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
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
              {mutation.isPending ? "발급 중…" : "초대 + 임시 비밀번호 발급"}
            </Button>
          </div>
        </form>
      )}

      {step === "result" && result && (
        <div className="space-y-4">
          <div className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              <strong>임시 비밀번호는 다시 조회할 수 없습니다.</strong> 본인에게 안전하게
              전달하고 첫 로그인 후 비밀번호 변경을 안내하세요.
            </span>
          </div>
          <div className="space-y-2">
            <Label>이메일</Label>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-md border border-foreground/20 bg-muted px-3 py-2 text-xs font-mono">
                {result.email}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={() => copy(result.email, "email")}
              >
                {copiedField === "email" ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>임시 비밀번호 (1회 노출)</Label>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-md border border-foreground/20 bg-muted px-3 py-2 text-xs font-mono">
                {result.temp_password}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={() => copy(result.temp_password, "password")}
              >
                {copiedField === "password" ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <p className="text-xs opacity-70">
            {result.name} ({roleLabel(result.role)}) — profile id: {result.profile_id}
          </p>
          <div className="flex items-center gap-2">
            <input
              id="ack"
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="size-4"
            />
            <label htmlFor="ack" className="text-sm">
              본인에게 안전하게 전달했음을 확인합니다.
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

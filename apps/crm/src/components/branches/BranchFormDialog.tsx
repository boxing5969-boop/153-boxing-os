import { type FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createBranch, updateBranch, type BranchDetail, type BranchStats } from "@/services/branches";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  branch?: BranchStats | BranchDetail | null;
}

export default function BranchFormDialog({ open, onClose, onSuccess, branch }: Props) {
  const { profile } = useAuth();
  const isEdit = !!branch;

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(branch?.name ?? "");
    setAddress(branch?.address ?? "");
    setPhone(branch?.phone ?? "");
    setStatus(branch?.status ?? "active");
    setError(null);
  }, [open, branch]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit && branch) {
        return updateBranch(branch.id, { name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined, status });
      } else {
        if (!profile?.company_id) throw new Error("company_id not found");
        return createBranch({ company_id: profile.company_id, name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined });
      }
    },
    onSuccess: () => onSuccess(),
    onError: (err) => setError(err instanceof Error ? err.message : "저장 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("지점명을 입력하세요"); return; }
    setError(null);
    mutation.mutate();
  }

  const STATUS_OPTIONS = [
    { value: "active",   label: "운영중",  color: "border-success bg-success/10 text-success" },
    { value: "inactive", label: "비활성",  color: "border-border bg-card text-muted-foreground" },
    { value: "closed",   label: "폐점",    color: "border-danger bg-danger/10 text-danger" },
  ];

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? "지점 편집" : "지점 추가"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="branch-name">지점명 <span className="text-danger">*</span></Label>
          <Input id="branch-name" autoFocus required placeholder="선릉점" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="branch-address">주소</Label>
          <Input id="branch-address" placeholder="서울시 강남구 ..." value={address} onChange={e => setAddress(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="branch-phone">대표 전화</Label>
          <Input id="branch-phone" type="tel" placeholder="02-1234-5678" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <Label>운영 상태</Label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all",
                    status === opt.value ? opt.color : "border-border bg-card text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
            <div className="size-1.5 rounded-full bg-danger shrink-0" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={mutation.isPending} className="gap-2 px-6">
            {mutation.isPending ? (
              <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />저장 중…</>
            ) : (isEdit ? "저장" : "지점 추가")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

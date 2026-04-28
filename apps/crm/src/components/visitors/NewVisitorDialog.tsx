import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { createVisitor } from "@/services/visitors";
import { listBranches } from "@/services/lookups";
import {
  VISITOR_PURPOSE_VALUES,
  visitPurposeLabel,
} from "@/components/visitors/VisitorStatusBadge";
import type { VisitPurpose } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
}

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

export function NewVisitorDialog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isHq = profile ? HQ_ROLES.has(profile.role) : false;

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: open && isHq,
    staleTime: 60_000,
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState<VisitPurpose>("consultation");
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const [visitAt, setVisitAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPhone("");
    setPurpose("consultation");
    setBranchId(profile?.branch_id ?? "");
    setVisitAt("");
    setError(null);
  }, [open, profile?.branch_id]);

  const mutation = useMutation({
    mutationFn: createVisitor,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["visitors"] });
      onClose();
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
      name: name.trim(),
      phone: phone.trim(),
      purpose,
      visit_at: visitAt ? new Date(visitAt).toISOString() : null,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title="방문자 신청 등록">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="vname">이름 *</Label>
            <Input id="vname" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vphone">전화 *</Label>
            <Input
              id="vphone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="purpose">목적 *</Label>
          <Select
            id="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as VisitPurpose)}
          >
            {VISITOR_PURPOSE_VALUES.map((p) => (
              <option key={p} value={p}>
                {visitPurposeLabel(p)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vbranch">지점 *</Label>
          {isHq ? (
            <Select
              id="vbranch"
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
            <Input id="vbranch" value={profile?.branch_id ?? "—"} disabled />
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="vat">방문 일시 (선택)</Label>
          <Input
            id="vat"
            type="datetime-local"
            value={visitAt}
            onChange={(e) => setVisitAt(e.target.value)}
          />
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "등록 중…" : "등록"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

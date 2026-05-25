/**
 * 문자 템플릿 관리 (B2B SaaS — wallet-aware schema).
 * - tenant 별 템플릿 목록
 * - 생성 / 편집 / 활성·비활성
 */
import { useEffect, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listMessageTemplates,
  upsertMessageTemplate,
  type MessageTemplateB2B,
} from "@/services/billing";

export default function B2BMessageTemplatesPage() {
  const { tenantId, currentBranchId } = useBranch();
  const [items, setItems] = useState<MessageTemplateB2B[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [edit, setEdit] = useState<Partial<MessageTemplateB2B> | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await listMessageTemplates(tenantId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  async function save() {
    if (!tenantId || !edit) return;
    if (!edit.name || !edit.content || !edit.category || !edit.message_type) {
      setError("이름·내용·유형·메시지타입은 필수입니다");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await upsertMessageTemplate({
        id: edit.id,
        tenant_id: tenantId,
        branch_id: currentBranchId ?? undefined,
        name: edit.name,
        content: edit.content,
        category: edit.category as "informational" | "marketing",
        message_type: edit.message_type as "sms" | "lms" | "mms",
        is_active: edit.is_active ?? true,
      });
      setEdit(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="문자 템플릿"
        description="자주 보내는 문자를 미리 저장"
        action={
          <Button onClick={() => setEdit({ category: "informational", message_type: "sms", is_active: true })}>
            새 템플릿
          </Button>
        }
      />

      {error && <Card className="p-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</Card>}

      {edit && (
        <Card className="p-5 space-y-3 border-blue-200 bg-blue-50/40">
          <div className="text-sm font-semibold">{edit.id ? "템플릿 수정" : "새 템플릿"}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-name">이름</Label>
              <Input
                id="t-name"
                value={edit.name ?? ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="t-cat">유형</Label>
                <select
                  id="t-cat"
                  value={edit.category ?? "informational"}
                  onChange={(e) => setEdit({ ...edit, category: e.target.value as "informational" | "marketing" })}
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="informational">정보성</option>
                  <option value="marketing">광고성</option>
                </select>
              </div>
              <div>
                <Label htmlFor="t-type">메시지</Label>
                <select
                  id="t-type"
                  value={edit.message_type ?? "sms"}
                  onChange={(e) => setEdit({ ...edit, message_type: e.target.value as "sms" | "lms" | "mms" })}
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="sms">SMS</option>
                  <option value="lms">LMS</option>
                  <option value="mms">MMS</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="t-content">본문</Label>
            <textarea
              id="t-content"
              value={edit.content ?? ""}
              onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              rows={4}
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
              placeholder="안녕하세요 …"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={edit.is_active ?? true}
              onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
            />
            활성
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEdit(null)}>
              취소
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "저장중…" : "저장"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-5 text-sm text-slate-400">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">등록된 템플릿이 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((t) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <Badge tone={t.is_active ? "success" : "muted"}>{t.is_active ? "활성" : "비활성"}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{t.name}</div>
                  <div className="text-xs text-slate-500 truncate">{t.content}</div>
                  <div className="mt-1 flex gap-2 text-[11px]">
                    {t.message_type && <Badge tone="info">{t.message_type.toUpperCase()}</Badge>}
                    {t.category && (
                      <Badge tone={t.category === "marketing" ? "warning" : "neutral"}>
                        {t.category === "marketing" ? "광고성" : "정보성"}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button variant="outline" onClick={() => setEdit(t)}>
                  편집
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

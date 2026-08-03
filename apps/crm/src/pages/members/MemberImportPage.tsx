import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  parseBrojExcel,
  uploadMembers,
  type ImportRow,
  type ImportReport,
} from "@/services/memberImport";

interface BranchOpt { id: string; name: string }

export default function MemberImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [branchId, setBranchId] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("branches")
      .select("id,name")
      .is("deleted_at", null)
      .order("name")
      .then(({ data }) => {
        const opts = (data ?? []) as BranchOpt[];
        setBranches(opts);
        const only = opts.length === 1 ? opts[0] : undefined;
        if (only) setBranchId(only.id);
      });
  }, []);

  const stats = useMemo(() => {
    const s = { active: 0, expired: 0, suspended: 0, consent: 0, lastVisit: 0, memberships: 0 };
    for (const r of rows) {
      s[r.status]++;
      if (r.marketing_consent) s.consent++;
      if (r.last_visit) s.lastVisit++;
      s.memberships += r.memberships.filter((m) => m.start && m.end).length;
    }
    return s;
  }, [rows]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(""); setReport(null); setFileName(f.name); setParsing(true);
    try {
      const parsed = await parseBrojExcel(f);
      setRows(parsed);
      if (!parsed.length) setError("회원 행을 찾지 못했습니다. 브로제이 '고객 목록' 엑셀이 맞는지 확인해 주세요.");
    } catch (err) {
      setError(`엑셀을 읽지 못했습니다: ${(err as Error).message}`);
      setRows([]);
    } finally {
      setParsing(false);
    }
  }

  async function onUpload() {
    if (!branchId) { setError("지점을 선택해 주세요."); return; }
    if (!rows.length) return;
    setUploading(true); setError(""); setProgress(0); setReport(null);
    try {
      const rep = await uploadMembers(rows, branchId, (d, t) => setProgress(Math.round((d / t) * 100)));
      setReport(rep);
    } catch (err) {
      setError(`업로드 실패: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="회원 명단 업로드" description="브로제이 '고객 목록' 엑셀을 올리면 회원·이용권·동의·출석·확장정보가 그대로 반영됩니다." />

      <Button variant="ghost" className="gap-1" onClick={() => navigate("/members")}>
        <ArrowLeft className="h-4 w-4" /> 회원 목록
      </Button>

      <Card className="p-6 space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">대상 지점</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
            <option value="">지점 선택</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">엑셀 파일 (.xlsx)</label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" />
          <div>
            <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={parsing || uploading}>
              <FileSpreadsheet className="h-4 w-4" />
              {fileName || "파일 선택"}
            </Button>
          </div>
          {parsing && <p className="text-sm text-muted-foreground">읽는 중…</p>}
        </div>

        {rows.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium mb-2">미리보기 — 총 {rows.length}명</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm text-muted-foreground">
              <span>활성 {stats.active}</span>
              <span>만료 {stats.expired}</span>
              <span>홀딩 {stats.suspended}</span>
              <span>광고 동의 {stats.consent}</span>
              <span>출석일 보유 {stats.lastVisit}</span>
              <span>이용권 {stats.memberships}건</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={onUpload} disabled={!rows.length || !branchId || uploading} className="gap-2">
            <Upload className="h-4 w-4" /> {uploading ? `업로드 중 ${progress}%` : `${rows.length}명 반영하기`}
          </Button>
          {uploading && (
            <div className="h-2 flex-1 max-w-xs rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        {report && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> 반영 완료
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <span>신규 {report.inserted}명</span>
              <span>갱신 {report.updated}명</span>
              <span>이용권 {report.memberships}건</span>
              <span>건너뜀 {report.skipped}명</span>
            </div>
            {report.errors.length > 0 && (
              <details className="text-sm text-danger">
                <summary>오류 {report.errors.length}건</summary>
                <ul className="mt-1 list-disc pl-5 space-y-0.5 max-h-40 overflow-auto">
                  {report.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate("/members")}>회원 목록 보기</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

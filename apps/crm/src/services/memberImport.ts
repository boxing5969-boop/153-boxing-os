/**
 * 브로제이 회원 명단 엑셀 업로드 — 파싱 + 분할 업로드
 * 브라우저에서 .xlsx 를 파싱해 구조화한 뒤, 워커 /api/admin/members/import 로
 * 배치(40명)씩 보낸다. (Workers 서브리퀘스트 한도 고려)
 */
import * as XLSX from "xlsx";
import { API_URL, getAuthHeaders } from "@/services/api";

export interface ImportMembership {
  plan_name: string;
  start: string | null;
  end: string | null;
  status: "active" | "expired";
  sessions: number | null;
}
export interface ImportRow {
  name: string;
  phone: string;
  gender: "male" | "female" | null;
  birth_date: string | null;
  status: "active" | "expired" | "suspended";
  created_at: string | null;
  last_visit: string | null;
  marketing_consent: boolean;
  memberships: ImportMembership[];
  profile: Record<string, string | number | null>;
}
export interface ImportReport {
  total: number; inserted: number; updated: number;
  memberships: number; skipped: number; errors: string[];
}

const STATUS: Record<string, ImportRow["status"]> = {
  활성: "active", 만료: "expired", 미등록: "expired",
  홀딩: "suspended", 임박: "active", 예정: "active",
};

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function parseDate(x: string): string | null {
  const t = x.replace(/\./g, "-").replace(/\s/g, "");
  const m = t.match(/(\d{4})-?(\d{1,2})-?(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (!y || !mo || !d) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function parseMoney(x: string): number | null {
  const v = x.replace(/,/g, "").trim();
  return /^\d+$/.test(v) ? Number(v) : null;
}
function parseMembership(txt: string, status: "active" | "expired"): ImportMembership | null {
  const t = str(txt);
  if (!t || t === "-") return null;
  let plan = t, start: string | null = null, end: string | null = null, sessions: number | null = null;
  const m = t.match(/\(([^)]*~[^)]*)\)/);
  const inner = m?.[1];
  if (m && inner) {
    plan = t.slice(0, m.index ?? 0).trim();
    const parts = inner.split("~");
    const p0 = parts[0];
    const p1 = parts[1];
    start = p0 ? parseDate(p0) : null;
    end = p1 ? parseDate(p1) : null;
  }
  const sm = plan.match(/(\d+)\s*회/);
  if (sm && sm[1]) sessions = Number(sm[1]);
  return { plan_name: plan, start, end, status, sessions };
}

/** 엑셀 파일 → 구조화된 회원 행 배열 */
export async function parseBrojExcel(file: File): Promise<ImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  if (!rows.length) return [];
  const hdr = (rows[0] as string[]).map((h) => str(h));
  const H = (name: string) => hdr.indexOf(name);
  const idx = {
    name: H("고객명"), gender: H("성별"), birth: H("생년월일"), phone: H("연락처"),
    status: H("상태"), created: H("최초 등록일"), coach: H("상담 담당자"),
    lastVisit: H("마지막 출석일"), consent: H("광고성 수신"),
    memHold: H("보유 멤버십"), memExp: H("만료 멤버십"),
    passHold: H("보유 이용권"), passExp: H("만료 이용권"),
    newRe: H("신규/재등록"), locker: H("보유 락커"), rental: H("보유 대여권"),
    cumPay: H("누적 결제 금액"), lastBuy: H("마지막 구매일"),
    mileage: H("보유 마일리지"), coupons: H("보유 유효 쿠폰"),
    runtalk: H("BROJ 운톡"), attNo: H("출석 번호"), notes: H("특이사항"),
    route: H("방문 경로"), purpose: H("운동 목적"), address: H("간단 주소"),
  };

  const out: ImportRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const name = str(r[idx.name]);
    if (!name) continue;
    const cell = (j: number) => (j >= 0 ? str(r[j]) : "");
    const dash = (s: string) => (s && s !== "-" ? s : null);
    const sel = (s: string) => (s && s !== "선택 안함" ? s : null);

    const memberships: ImportMembership[] = [];
    for (const [j, st] of [[idx.memHold, "active"], [idx.memExp, "expired"], [idx.passHold, "active"], [idx.passExp, "expired"]] as const) {
      const m = parseMembership(cell(j), st);
      if (m) memberships.push(m);
    }
    out.push({
      name,
      phone: cell(idx.phone),
      gender: cell(idx.gender) === "남성" ? "male" : cell(idx.gender) === "여성" ? "female" : null,
      birth_date: parseDate(cell(idx.birth)),
      status: STATUS[cell(idx.status)] ?? "expired",
      created_at: parseDate(cell(idx.created)),
      last_visit: parseDate(cell(idx.lastVisit)),
      marketing_consent: cell(idx.consent) === "동의",
      memberships,
      profile: {
        new_or_re: dash(cell(idx.newRe)),
        locker: dash(cell(idx.locker)),
        rental: dash(cell(idx.rental)),
        cumulative_payment: parseMoney(cell(idx.cumPay)),
        last_purchase_date: parseDate(cell(idx.lastBuy)),
        mileage: dash(cell(idx.mileage)),
        coupons: dash(cell(idx.coupons)),
        broj_runtalk: dash(cell(idx.runtalk)),
        attendance_no: dash(cell(idx.attNo)),
        notes: dash(cell(idx.notes)),
        visit_route: sel(cell(idx.route)),
        exercise_purpose: sel(cell(idx.purpose)),
        address: dash(cell(idx.address)),
        coach_name: dash(cell(idx.coach)),
        status_orig: cell(idx.status),
      },
    });
  }
  return out;
}

/** 배치(40명)씩 워커로 업로드. 진행률 콜백 제공. */
export async function uploadMembers(
  rows: ImportRow[],
  branchId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport> {
  const BATCH = 40;
  const agg: ImportReport = { total: rows.length, inserted: 0, updated: 0, memberships: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await fetch(`${API_URL}/api/admin/members/import`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ branch_id: branchId, rows: chunk }),
    });
    const json = (await res.json().catch(() => null)) as
      | { success: boolean; data?: ImportReport; message?: string }
      | null;
    if (!res.ok || !json?.success || !json.data) {
      agg.errors.push(json?.message ?? `배치 ${i / BATCH + 1} 실패 (HTTP ${res.status})`);
      agg.skipped += chunk.length;
    } else {
      agg.inserted += json.data.inserted;
      agg.updated += json.data.updated;
      agg.memberships += json.data.memberships;
      agg.skipped += json.data.skipped;
      agg.errors.push(...json.data.errors);
    }
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
  }
  return agg;
}

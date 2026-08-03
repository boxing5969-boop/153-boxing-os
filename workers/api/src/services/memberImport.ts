/**
 * 회원 명단 업로드(브로제이 엑셀) → 153os upsert
 *
 * CRM 이 엑셀을 브라우저에서 파싱해 구조화된 행 배열을 보내면, 워커가
 * DB 함수 import_member_roster() 를 "한 번" 호출해 배치 전체를 처리한다.
 *
 * ⚠️ 회원마다 여러 번 DB 호출을 하면 Cloudflare Workers 의 요청당 서브리퀘스트
 *    한도(무료 50개)에 걸려 ~6명만 처리되고 죽는다. 그래서 배치 전체를
 *    단일 RPC(서브리퀘스트 1개)로 처리한다. 함수는 (phone+name+company) 로
 *    매칭해 재업로드 시 중복 없이 갱신한다(원자적 — 실패 시 배치 전체 롤백).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";

export interface ImportMembership {
  plan_name: string;
  start: string | null;
  end: string | null;
  status: "active" | "expired";
  sessions: number | null;
}

export interface ImportProfile {
  new_or_re?: string | null;
  locker?: string | null;
  rental?: string | null;
  cumulative_payment?: number | null;
  last_purchase_date?: string | null;
  mileage?: string | null;
  coupons?: string | null;
  broj_runtalk?: string | null;
  attendance_no?: string | null;
  notes?: string | null;
  visit_route?: string | null;
  exercise_purpose?: string | null;
  address?: string | null;
  coach_name?: string | null;
  status_orig?: string | null;
}

export interface ImportRow {
  name: string;
  phone: string;
  gender?: "male" | "female" | null;
  birth_date?: string | null;
  status: "active" | "expired" | "suspended";
  created_at?: string | null;
  last_visit?: string | null;
  marketing_consent: boolean;
  memberships: ImportMembership[];
  profile: ImportProfile;
}

export interface ImportReport {
  total: number;
  inserted: number;
  updated: number;
  memberships: number;
  skipped: number;
  errors: string[];
}

/** 배치 전체를 DB 함수 1회 호출로 upsert (서브리퀘스트 1개) */
export async function importMembers(
  db: SupabaseClient,
  _env: Env,
  rows: ImportRow[],
  branchId: string,
  companyId: string,
  brandId: string,
): Promise<ImportReport> {
  const { data, error } = await db.rpc("import_member_roster", {
    p_branch_id: branchId,
    p_company_id: companyId,
    p_brand_id: brandId,
    p_rows: rows,
  });

  if (error) {
    return {
      total: rows.length,
      inserted: 0, updated: 0, memberships: 0,
      skipped: rows.length,
      errors: [error.message],
    };
  }

  const d = (data ?? {}) as { inserted?: number; updated?: number; memberships?: number };
  return {
    total: rows.length,
    inserted: d.inserted ?? 0,
    updated: d.updated ?? 0,
    memberships: d.memberships ?? 0,
    skipped: 0,
    errors: [],
  };
}

// Database 타입 placeholder.
// Phase 3 마이그레이션 적용 후 supabase gen types typescript 결과로 교체 권장:
//   bunx supabase gen types typescript --project-id <ref> > packages/shared/src/types/db.ts
//
// 현재는 supabase-js 의 .from(<any-table>) 호출이 컴파일되도록 모든 테이블을 generic 행으로 정의.

type GenericTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: never[];
};

export interface Database {
  public: {
    Tables: Record<string, GenericTable>;
    Views: Record<string, GenericTable>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

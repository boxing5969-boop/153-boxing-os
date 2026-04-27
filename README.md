# 153 BOXING OS

153복싱짐 프랜차이즈 CRM + 출입통제 시스템.

> 헌장: [`CLAUDE.md`](./CLAUDE.md) — 절대 규칙 + Phase 0~8 계획
> 아키텍처 문서: [`docs/`](./docs/)

## 빠른 시작

```bash
bun install                    # 의존성 설치 (모노레포 전체)
bun run dev:crm                # CRM 개발 서버 (http://localhost:5173)
bun run dev:api                # Workers API 개발 서버 (http://localhost:8787)
bun run typecheck              # 전체 타입체크
bun run build                  # 전체 빌드
bun run lint                   # ESLint
bun run format                 # Prettier
```

## 모노레포 구조

```
apps/crm/                  # CRM 화면 (React + Vite + Cloudflare Pages)
workers/api/               # Cloudflare Workers (출입 판단 API)
packages/shared/           # 공통 타입/유틸
packages/device-adapters/  # 단말기 추상화 (Suprema/ZKTeco/Hikvision/Mock)
supabase/                  # DB 마이그레이션 + seed
docs/                      # 아키텍처 문서
.github/workflows/         # CI
```

## Supabase 셋업 (Phase 3)

1. **Supabase 프로젝트 생성** — Dashboard 에서 Free / Seoul 리전 / 본인 계정으로 생성
2. **API 키 복사** — Settings → API
   - `Project URL` → `VITE_SUPABASE_URL` / `SUPABASE_URL`
   - `anon public` → `VITE_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (Workers 만 사용 — 절대 클라이언트 노출 금지)
3. **로컬 환경변수 작성:**
   ```bash
   cp apps/crm/.env.example apps/crm/.env       # CRM 용 VITE_ 변수 채우기
   cp .env.example .env                         # 루트 .env (Workers 용)
   ```
4. **CLI 링크 (Supabase CLI 필요):**
   ```bash
   bunx supabase login
   bunx supabase link --project-ref <your-project-ref>
   ```
   (또는 `supabase/config.toml` 의 `project_id` 를 직접 수정)
5. **마이그레이션 적용 (선택지 2개):**
   - **A.** CLI 사용: `bunx supabase db push`
   - **B.** Dashboard 사용: Supabase Studio → SQL Editor 에 `supabase/migrations/*.sql` 6개를 순서대로 붙여넣기
6. **시드 적용 (선택):** `supabase/seed.sql` 을 SQL Editor 에 붙여넣기
7. **타입 재생성 (마이그레이션 후 권장):**
   ```bash
   bunx supabase gen types typescript --project-id <ref> > packages/shared/src/types/db.ts
   ```

## Phase 진행 상태

- [x] Phase 0: 폴더 진단 + git init
- [x] Phase 1: 아키텍처 문서 8종
- [x] Phase 2: 모노레포 scaffold
- [x] Phase 3: DB 스키마 + 마이그레이션
- [ ] Phase 4: Workers API 골격
- [ ] Phase 5: CRM 화면 1차
- [ ] Phase 6: 출입권한 자동화
- [ ] Phase 7: Mock Device 통합 테스트
- [ ] Phase 8: 실제 장비 연동

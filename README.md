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
supabase/                  # DB 마이그레이션 (Phase 3)
docs/                      # 아키텍처 문서
.github/workflows/         # CI
```

## Phase 진행 상태

- [x] Phase 0: 폴더 진단 + git init
- [x] Phase 1: 아키텍처 문서 8종
- [x] Phase 2: 모노레포 scaffold (현재)
- [ ] Phase 3: DB 스키마 + 마이그레이션
- [ ] Phase 4: Workers API 골격
- [ ] Phase 5: CRM 화면 1차
- [ ] Phase 6: 출입권한 자동화
- [ ] Phase 7: Mock Device 통합 테스트
- [ ] Phase 8: 실제 장비 연동

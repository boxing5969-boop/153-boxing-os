# 07. Phase 2 — 첫 구현 단계 파일 목록

> Phase 1 산출물 #9 — 모노레포 scaffold 시 만들 파일 정확한 목록
> 작성일: 2026-04-28

---

## 1. 패키지 매니저 결정 (선택지)

| 매니저 | 장점 | 단점 |
|---|---|---|
| **bun** | 가장 빠름, 게임핏퀘스트도 bun (사용자 친숙) | Workers 호환성 일부 미흡, Windows 설치 안정성 |
| **pnpm** | 안정적, Cloudflare Workers 공식 권장 | 추가 설치 |

→ **권장: pnpm**. 이유 = Workers ↔ Hono ↔ wrangler 조합에서 가장 검증됨, 게임핏퀘스트와 의존성 충돌 위험 0.
→ 다만 사용자가 bun 을 선호하면 그 결정에 따름. **Phase 2 시작 시 사용자 확인**.

---

## 2. 루트 파일 (10개)

| 경로 | 내용 |
|---|---|
| `package.json` | 워크스페이스 루트, scripts: `build`, `typecheck`, `lint`, `format`, `dev:crm`, `dev:api` |
| `pnpm-workspace.yaml` | `apps/*`, `workers/*`, `packages/*` |
| `tsconfig.base.json` | strict + composite + path aliases (`@153/shared`, `@153/device-adapters`) |
| `.eslintrc.cjs` | TypeScript + react + prettier 통합 |
| `.prettierrc` | 표준 (2 space, 100 col, single quote 안 씀, semi true) |
| `.editorconfig` | UTF-8 + LF |
| `.nvmrc` | Node 20 LTS |
| `.env.example` | 키 목록만 — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `QR_SIGNING_SECRET`, `DEVICE_KMS_KEY` |
| `.gitignore` | (Phase 0 에서 생성됨, 보강만) |
| `README.md` | 시작 가이드 (`pnpm install` → `pnpm dev:crm` 등 5줄) |

---

## 3. apps/crm — Vite + React (15개 파일)

```
apps/crm/
├── package.json                       # vite, react, react-dom, @supabase/supabase-js, react-router-dom, @tanstack/react-query, tailwindcss, lucide-react
├── tsconfig.json                      # extends ../../tsconfig.base.json
├── vite.config.ts                     # alias @ → src/
├── tailwind.config.ts                 # shadcn/ui 색상 토큰
├── postcss.config.cjs
├── index.html                         # 루트 마운트
├── public/
│   ├── _redirects                     # /* /index.html 200 (Cloudflare Pages SPA)
│   └── favicon.ico                    # 임시
└── src/
    ├── main.tsx                       # React 18 root + QueryClient + Router
    ├── App.tsx                        # 라우트 트리 — 페이지 1개만 (HelloPage)
    ├── pages/
    │   └── HelloPage.tsx              # "153 BOXING OS — Phase 2 OK" 표시
    ├── components/ui/
    │   └── button.tsx                 # shadcn Button 1개만
    ├── lib/
    │   └── cn.ts                      # className 합치기 유틸
    └── styles/
        └── globals.css                # tailwind directives + shadcn 색상 변수
```

**의존성 (정확):**
```jsonc
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.51.0",
    "@supabase/supabase-js": "^2.45.0",
    "lucide-react": "^0.400.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

> shadcn/ui 컴포넌트는 `npx shadcn@latest add button` 으로 1회 추가. CLI 가 `components.json` + `lib/cn.ts` 자동 생성. Phase 5 에서 추가 컴포넌트는 그때그때 add.

---

## 4. workers/api — Hono + Wrangler (10개 파일)

```
workers/api/
├── package.json                       # hono, @cloudflare/workers-types, @supabase/supabase-js, wrangler
├── tsconfig.json                      # extends base, types: ["@cloudflare/workers-types"]
├── wrangler.toml                      # name, main, compatibility_date, vars, secrets, kv_namespaces
└── src/
    ├── index.ts                       # Hono app + routes mount + GET /health
    ├── routes/
    │   ├── access.ts                  # 빈 핸들러 (Phase 4 에서 채움)
    │   ├── devices.ts                 # 빈 핸들러
    │   └── admin.ts                   # 빈 핸들러
    ├── middleware/
    │   ├── cors.ts                    # CORS 처리
    │   └── errorHandler.ts            # Hono onError
    └── lib/
        └── env.ts                     # Bindings 인터페이스 (SUPABASE_URL 등)
```

**의존성:**
```jsonc
{
  "dependencies": {
    "hono": "^4.5.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240900.0",
    "wrangler": "^3.70.0",
    "typescript": "^5.5.0"
  }
}
```

**`wrangler.toml` 예시:**
```toml
name = "153-boxing-os-api"
main = "src/index.ts"
compatibility_date = "2026-04-28"
node_compat = false

[vars]
ENVIRONMENT = "development"

[[kv_namespaces]]
binding = "QR_USED"
id = "<phase 4 에서 발급>"

# 시크릿은 wrangler secret put 으로 등록
# - SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY
# - QR_SIGNING_SECRET
# - DEVICE_KMS_KEY
```

---

## 5. packages/shared (5개 파일)

```
packages/shared/
├── package.json                       # name: @153/shared
├── tsconfig.json
└── src/
    ├── index.ts                       # re-export
    ├── types/
    │   ├── db.ts                      # 빈 export (Phase 3 에서 supabase gen types 결과 import)
    │   └── api.ts                     # ApiResponse<T> 만 정의
    ├── constants/
    │   └── deniedReasons.ts           # 거절 사유 한국어 매핑
    └── validation/
        └── index.ts                   # 빈 (Phase 4 에서 zod 스키마 추가)
```

`packages/shared/src/types/api.ts`:
```typescript
export type ApiResponse<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: { code: string; message: string }; data?: null };
```

---

## 6. packages/device-adapters (8개 파일)

```
packages/device-adapters/
├── package.json                       # name: @153/device-adapters
├── tsconfig.json
└── src/
    ├── index.ts                       # re-export interface + factory
    ├── interface.ts                   # AccessDeviceAdapter (docs/04 §2 그대로)
    ├── factory.ts                     # getAdapter(vendor)
    └── adapters/
        ├── mock.ts                    # 메서드 시그니처만, throw new Error("not implemented") (Phase 7 에서 채움)
        ├── suprema.ts                 # 동일하게 스텁
        ├── zkteco.ts                  # 동일하게 스텁
        └── hikvision.ts               # 동일하게 스텁
```

> Phase 2 단계에서 실제 동작은 안 함. 인터페이스 컴파일만 통과시켜 다른 패키지에서 import 가능하도록.

---

## 7. CI / 인프라 파일 (3개)

```
.github/
└── workflows/
    └── ci.yml                         # PR / push 시 typecheck + lint + build
```

**`ci.yml` 골격:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r lint
      - run: pnpm -r build
```

---

## 8. 총계 (Phase 2 = 약 51개 파일 + lockfile)

| 영역 | 파일 수 |
|---|---|
| 루트 | 10 |
| apps/crm | 15 |
| workers/api | 10 |
| packages/shared | 5 |
| packages/device-adapters | 8 |
| CI | 1 |
| supabase/ | 0 (Phase 3 에서) |
| **합계** | **49 + lockfile** |

---

## 9. Phase 2 검증 체크리스트

```
[ ] pnpm install — 성공, lockfile 생성
[ ] pnpm -r typecheck — 0 error
[ ] pnpm -r lint — 0 error (warn 허용)
[ ] pnpm -r build — 모든 패키지 build OK
[ ] cd apps/crm && pnpm dev — http://localhost:5173 에 "153 BOXING OS — Phase 2 OK" 표시
[ ] cd workers/api && pnpm dev — http://localhost:8787/health → { ok: true }
[ ] git status — 의도한 파일만 추가, 누락 없음
[ ] CI 워크플로 — 첫 push 후 GitHub Actions 통과 확인
```

---

## 10. Phase 2 진입 전 사용자 확인 사항

1. **패키지 매니저 — pnpm 권장 vs bun 선호?**
2. **Node 버전 — 20 LTS 고정 OK?**
3. **CRM 의 라우터 — react-router 권장 (게임핏퀘스트와 동일) vs TanStack Router?**
4. **CSS — Tailwind + shadcn/ui 확정? (CLAUDE.md L42 와 동일)**
5. **CI — GitHub Actions Phase 2 부터 시작 OK? (요금 부담 거의 없음)**

위 5가지 답을 받은 후 Phase 2 의 실제 파일 생성을 시작한다.

---

**Phase 1 문서 끝.** 8개 문서 (`00-overview.md` ~ `07-phase2-files.md`) 가 완성되면 Phase 2 진입 가능.

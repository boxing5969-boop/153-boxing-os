# syntax=docker/dockerfile:1.7
# ============================================================
# billing-proxy — Google Cloud Run 컨테이너
# ============================================================
# Bun 모노레포에서 단일 워크스페이스만 빌드:
#   1) 워크스페이스 루트 의존성 + apps/billing-proxy 의존성 설치
#   2) tsc 빌드 → dist
#   3) production node:slim 으로 dist + node_modules 만 복사
# Cloud Run: PORT=8080 환경변수 자동 주입
# ============================================================

FROM node:20-slim AS builder
WORKDIR /repo

# 워크스페이스 metadata 만 먼저 복사 (캐시 활용)
COPY package.json bun.lock* tsconfig.base.json ./
COPY apps/billing-proxy/package.json apps/billing-proxy/
RUN corepack enable && npm install --workspaces=false --prefix apps/billing-proxy

# 소스 복사 + 빌드
COPY apps/billing-proxy/tsconfig.json apps/billing-proxy/
COPY apps/billing-proxy/src apps/billing-proxy/src
RUN cd apps/billing-proxy && npm run build

# ---------------- runtime ----------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /repo/apps/billing-proxy/package.json ./
COPY --from=builder /repo/apps/billing-proxy/node_modules ./node_modules
COPY --from=builder /repo/apps/billing-proxy/dist ./dist

# 비-root 사용자
RUN useradd -r -u 1001 -g 0 appuser && chown -R 1001:0 /app
USER 1001

EXPOSE 8080
CMD ["node", "dist/index.js"]

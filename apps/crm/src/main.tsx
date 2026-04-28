import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary, initSentry } from "@/lib/sentry";
import { ErrorFallback } from "@/components/ErrorFallback";
import "./styles/globals.css";

initSentry();

// Phase 20 — 빠른 실패 + 캐시 정책으로 체감 성능 개선:
// - retry: 1 (기본 3 → 1, 5-7초 대기 시간을 ~1초로 단축)
// - retryDelay: 500ms 고정
// - staleTime: 30s (페이지 이동 시 캐시 재사용)
// - refetchOnWindowFocus: false (탭 포커스마다 재요청 방지 — 운영 중 깜빡임)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: 500,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback error={error} resetError={resetError} />
      )}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

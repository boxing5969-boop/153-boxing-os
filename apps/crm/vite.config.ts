import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@153/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@153/device-adapters": path.resolve(__dirname, "../../packages/device-adapters/src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // recharts(차트 라이브러리)는 본질적으로 ~370kB라 700kB까지는 경고하지 않음
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // vendor 라이브러리를 용도별 청크로 분리한다.
        // - 거의 안 바뀌는 vendor 코드를 별도 청크로 빼면 브라우저 캐시 적중률이 올라가고
        // - 진입 청크(index)가 작아져 CRM 첫 화면 로딩이 빨라진다.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("recharts") ||
            id.includes("d3-") ||
            id.includes("internmap") ||
            id.includes("victory-vendor")
          ) {
            return "charts";
          }
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@sentry")) return "sentry";
          if (id.includes("react-router")) return "router";
          if (id.includes("@tanstack")) return "query";
          return "vendor";
        },
      },
    },
  },
});

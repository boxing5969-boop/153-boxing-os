import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt", "icons/apple-touch-icon.png"],
      manifest: {
        name: "153OS — 153복싱짐 운영 시스템",
        short_name: "153OS",
        description: "153복싱짐 프랜차이즈 CRM·출입통제 운영 콘솔",
        lang: "ko",
        theme_color: "#0F1B2D",
        background_color: "#FFFFFF",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // CRM은 동적 데이터(회원·출입 로그)가 많아 API 응답은 캐싱하지 않는다.
        // 정적 자산(JS·CSS·이미지·폰트)만 자동 캐싱.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"],
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        // 개발 모드에서는 PWA 비활성 (불필요한 SW 등록 방지)
        enabled: false,
      },
    }),
  ],
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

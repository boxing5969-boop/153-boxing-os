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
});

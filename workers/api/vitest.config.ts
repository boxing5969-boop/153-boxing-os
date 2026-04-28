import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@153/shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@153/device-adapters": path.resolve(__dirname, "../../packages/device-adapters/src"),
    },
  },
});

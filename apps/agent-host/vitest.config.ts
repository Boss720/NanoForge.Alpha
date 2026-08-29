import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@protocol": path.resolve(__dirname, "../../packages/protocol/src"),
    },
  },
});

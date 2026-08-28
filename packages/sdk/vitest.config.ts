import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@nanoforge/protocol": path.resolve(__dirname, "../protocol/src"),
      "@nanoforge/core": path.resolve(__dirname, "../core/src"),
      "@protocol": path.resolve(__dirname, "../protocol/src"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@protocol": path.resolve(__dirname, "./packages/protocol/src"),
      "@nanoforge/protocol": path.resolve(__dirname, "./packages/protocol/src"),
      "@nanoforge/core": path.resolve(__dirname, "./packages/core/src"),
      "@nanoforge/sdk": path.resolve(__dirname, "./packages/sdk/src"),
    },
  },
})

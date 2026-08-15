import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true
  }
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});

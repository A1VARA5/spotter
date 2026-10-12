import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.join(import.meta.dirname, "src") } },
  // PGlite setup can take longer than the defaults when several workers start at once.
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 },
});

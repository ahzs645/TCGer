import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: {
    "@": `${root}frontend/src`,
    "@tcg/api-types": `${root}packages/api-types/src/index.ts`,
  } },
  test: {
    environment: "node",
    include: ["frontend/src/lib/api/health-features.test.ts", "frontend/src/lib/api/server.api-contract.test.ts", "backend/src/api/routes/server.api-contract.test.ts"],
    restoreMocks: true,
    testTimeout: 10000,
  },
});

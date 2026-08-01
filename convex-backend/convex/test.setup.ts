/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import betterAuthSchema from "./betterAuth/schema";
import schema from "./schema";

export const TEST_BRIDGE_SECRET = "tcger-local-convex-bridge-secret-2026";

export const modules = import.meta.glob("./**/!(*.*.*)*.*s");
export const betterAuthModules = import.meta.glob("./betterAuth/**/*.ts");

export function createTestConvex() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterAuth", betterAuthSchema, betterAuthModules);
  return t;
}

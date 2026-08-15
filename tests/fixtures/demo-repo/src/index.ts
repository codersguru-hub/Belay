import type { HealthResult } from "./contracts.js";

export function health(): HealthResult {
  return { ok: true };
}

export const serviceName = "fixture";

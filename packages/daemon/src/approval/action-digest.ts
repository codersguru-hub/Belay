import { createHash } from "node:crypto";
import { canonicalJson } from "../indexer/canonical-json.js";

export interface CanonicalApprovalAction {
  executor: "local-process";
  target: string;
  commandId: string;
  args: readonly string[];
  workingDirectory: string;
  envProfile: string | null;
  policyVersion: string;
  expiresAt: string;
}

export function actionDigest(action: CanonicalApprovalAction): string {
  return createHash("sha256").update(canonicalJson(action)).digest("hex");
}

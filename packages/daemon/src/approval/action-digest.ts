import { createHash } from "node:crypto";
import { canonicalJson } from "../indexer/canonical-json.js";
import type { KnowledgeApprovalPreview } from "@belay/contracts";

export interface CanonicalApprovalAction {
  executor: "local-process";
  target: string;
  commandId: string;
  args: readonly string[];
  workingDirectory: string;
  envProfile: string | null;
  policyVersion: string;
  expiresAt: string;
  // Omitted entirely (not just undefined) for commands with no stdin payload, so existing
  // digests are unaffected. Present as a hash — never the raw prompt — so a decision binds to
  // the exact stdin content without inflating or leaking it through the digest itself.
  stdinDigest?: string;
}

export function actionDigest(action: CanonicalApprovalAction): string {
  return createHash("sha256").update(canonicalJson(action)).digest("hex");
}

export interface KnowledgeApprovalPayload extends KnowledgeApprovalPreview {
  workspaceId: string;
  projectId: string | null;
  proposedBy: string;
}

export interface CanonicalKnowledgeApprovalAction {
  executor: "knowledge-store";
  target: string;
  actionKind: "knowledge";
  payload: KnowledgeApprovalPayload;
  policyVersion: string;
  expiresAt: string;
}

export function knowledgeActionDigest(action: CanonicalKnowledgeApprovalAction): string {
  return createHash("sha256").update(canonicalJson(action)).digest("hex");
}

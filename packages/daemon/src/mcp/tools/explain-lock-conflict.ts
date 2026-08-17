import { randomUUID } from "node:crypto";
import {
  ExplainLockConflictInputSchema,
  type CloudLockConflict,
  type ExplainLockConflictResult
} from "@agentmesh/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import type { ManifestService } from "../../indexer/manifest-service.js";
import type { CloudIntelligenceService } from "../../cloud/cloud-intelligence-service.js";
import { CloudIntelligenceUnavailableError } from "../../cloud/cloud-intelligence-service.js";
import { EgressRejectedError } from "../../cloud/egress-guard.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

/** Alias shape accepted by the cloud contract; keeps agent names from becoming free-form egress. */
function toAlias(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 80) || fallback;
}

export function registerExplainLockConflict(
  server: McpServer,
  coordination: CoordinationService,
  manifests: ManifestService,
  cloudIntelligence: CloudIntelligenceService
): void {
  server.registerTool(
    "explain_lock_conflict",
    {
      title: "Explain Lock Conflict",
      description:
        "Explain why a requested file set collides with locks held by other agents and suggest a non-conflicting split. Returns the deterministic local split always, plus a Gemini advisory when the cloud plane is available. Advisory only: this never acquires, releases, or overrides a lock.",
      inputSchema: ExplainLockConflictInputSchema
    },
    async (input) => {
      try {
        const local = coordination.inspectLockConflict({
          projectRoot: input.projectRoot,
          filePaths: input.filePaths
        });

        const base = {
          ok: true as const,
          heldPaths: local.heldPaths,
          availablePaths: local.availablePaths,
          retryable: local.availablePaths.length > 0,
          correlationId: randomUUID()
        };

        // Nothing is actually contended - no reason to spend a cloud call.
        if (local.heldPaths.length === 0) {
          return successfulToolResult({
            ...base,
            advisory: null,
            advisoryState: "generated"
          } satisfies ExplainLockConflictResult);
        }

        // Enrich each contended path with exported symbol kinds from the last manifest so the
        // model can reason about *what* overlaps, not just which filenames collide.
        const topology = new Map(
          (manifests.getLatest(input.projectRoot)?.manifest.topology ?? []).map((entry) => [
            entry.path,
            [...new Set(entry.exports.map((item) => item.kind))].sort()
          ])
        );

        const conflict: CloudLockConflict = {
          requesterAlias: toAlias(input.agentName, "requesting-agent"),
          heldPaths: local.heldPaths.map((held) => ({
            path: held.path,
            holderAlias: toAlias(held.holderAgent, "holding-agent"),
            symbolKinds: topology.get(held.path) ?? []
          })),
          availablePaths: local.availablePaths
        };

        try {
          const result = await cloudIntelligence.explainLockConflict(conflict);
          return successfulToolResult({
            ...base,
            advisory: {
              summary: result.summary,
              ...(result.riskLevel ? { riskLevel: result.riskLevel } : {}),
              model: result.model,
              generatedAt: result.generatedAt
            },
            advisoryState: "generated"
          } satisfies ExplainLockConflictResult);
        } catch (error) {
          // The advisory plane is strictly optional. A rejected, unconfigured, or unreachable
          // cloud must still leave the caller with the deterministic local split.
          const advisoryState =
            error instanceof EgressRejectedError
              ? "blocked_by_egress_policy"
              : error instanceof CloudIntelligenceUnavailableError && error.code === "NOT_CONFIGURED"
                ? "not_configured"
                : "unavailable";
          return successfulToolResult({
            ...base,
            advisory: null,
            advisoryState
          } satisfies ExplainLockConflictResult);
        }
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

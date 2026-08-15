import { ReindexProjectInputSchema } from "@agentmesh/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ManifestService } from "../../indexer/manifest-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerReindexProject(
  server: McpServer,
  manifests: ManifestService
): void {
  server.registerTool(
    "reindex_project",
    {
      title: "Reindex Project",
      description:
        "Regenerate the deterministic, secret-safe project manifest and return bounded metrics only.",
      inputSchema: ReindexProjectInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(manifests.metrics(manifests.indexProject(input.projectRoot)));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

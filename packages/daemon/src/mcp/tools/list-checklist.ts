import { ListChecklistInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerListChecklist(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "list_checklist",
    {
      title: "List Shared Checklist",
      description:
        "Read the deterministic shared project checklist, including dependencies, owners, progress, blockers, and verification evidence.",
      inputSchema: ListChecklistInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.listChecklist(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

import { AddChecklistItemInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerAddChecklistItem(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "add_checklist_item",
    {
      title: "Add Checklist Item",
      description:
        "Add an auditable pending work item with dependencies, acceptance criteria, and priority to the shared project checklist.",
      inputSchema: AddChecklistItemInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.addChecklistItem(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

import { ListKnowledgeInputSchema } from "@agentmesh/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerListKnowledge(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "list_knowledge",
    {
      title: "List Shared Knowledge",
      description:
        "Read approved project and workspace facts with provenance and supersession state.",
      inputSchema: ListKnowledgeInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.listKnowledge(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

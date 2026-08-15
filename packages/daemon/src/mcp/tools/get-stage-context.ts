import { GetStageContextInputSchema } from "@agentmesh/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerGetStageContext(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "get_stage_context",
    {
      title: "Get Stage Context",
      description:
        "Read the active project stage, current tasks/file locks, and bounded recent agent memory.",
      inputSchema: GetStageContextInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.getStageContext(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}


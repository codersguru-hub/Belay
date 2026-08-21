import { HeartbeatTaskInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerHeartbeatTask(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "heartbeat_task",
    {
      title: "Heartbeat Task",
      description:
        "Extend an owned active task lease and all of its file locks in one transaction.",
      inputSchema: HeartbeatTaskInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.heartbeatTask(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}


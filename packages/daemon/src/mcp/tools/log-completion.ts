import { LogCompletionInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerLogCompletion(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "log_completion",
    {
      title: "Log Completion",
      description:
        "Complete an owned active task, its linked checklist item and verification evidence, release its locks, and append shared activity atomically.",
      inputSchema: LogCompletionInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.logCompletion(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

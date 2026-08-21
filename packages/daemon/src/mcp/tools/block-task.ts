import { BlockTaskInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerBlockTask(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "block_task",
    {
      title: "Block Task",
      description:
        "Mark an owned active task and its checklist item blocked, record evidence, and release its file locks atomically.",
      inputSchema: BlockTaskInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.blockTask(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

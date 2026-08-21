import { AcquireTaskInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerAcquireTask(server: McpServer, coordination: CoordinationService): void {
  server.registerTool(
    "acquire_task",
    {
      title: "Acquire Task",
      description:
        "Atomically acquire a task and its complete repository-relative file set under one lease, optionally claiming a ready checklist item.",
      inputSchema: AcquireTaskInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.acquireTask(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

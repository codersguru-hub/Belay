import { ReportTaskProgressInputSchema } from "@agentmesh/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../../coordination/coordination-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerReportTaskProgress(
  server: McpServer,
  coordination: CoordinationService
): void {
  server.registerTool(
    "report_task_progress",
    {
      title: "Report Task Progress",
      description:
        "Append an idempotent progress event for an owned active task and update its linked checklist item.",
      inputSchema: ReportTaskProgressInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(coordination.reportTaskProgress(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

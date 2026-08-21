import { RunProjectCommandInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ApprovalService } from "../../approval/approval-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerRunProjectCommand(
  server: McpServer,
  approvals: ApprovalService
): void {
  server.registerTool(
    "run_project_command",
    {
      title: "Run Registered Project Command",
      description:
        "Execute a registered shell-free command with strict path policy, minimal environment injection, bounded output, and secret redaction.",
      inputSchema: RunProjectCommandInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(await approvals.request(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

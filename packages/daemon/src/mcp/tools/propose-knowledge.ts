import { ProposeKnowledgeInputSchema } from "@belay/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ApprovalService } from "../../approval/approval-service.js";
import { failedToolResult, successfulToolResult } from "../tool-result.js";

export function registerProposeKnowledge(
  server: McpServer,
  approvals: ApprovalService
): void {
  server.registerTool(
    "propose_knowledge",
    {
      title: "Propose Shared Knowledge",
      description:
        "Propose a durable project or workspace fact. The fact remains invisible to agents until a human approves its exact digest.",
      inputSchema: ProposeKnowledgeInputSchema
    },
    async (input) => {
      try {
        return successfulToolResult(approvals.proposeKnowledge(input));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );
}

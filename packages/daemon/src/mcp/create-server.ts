import { McpServer } from "@modelcontextprotocol/server";
import type { CoordinationService } from "../coordination/coordination-service.js";
import type { ManifestService } from "../indexer/manifest-service.js";
import type { ApprovalService } from "../approval/approval-service.js";
import { registerProjectManifestResource } from "./resources/project-manifest.js";
import { registerAcquireTask } from "./tools/acquire-task.js";
import { registerGetStageContext } from "./tools/get-stage-context.js";
import { registerHeartbeatTask } from "./tools/heartbeat-task.js";
import { registerLogCompletion } from "./tools/log-completion.js";
import { registerReindexProject } from "./tools/reindex-project.js";
import { registerRunProjectCommand } from "./tools/run-project-command.js";
import { registerAddChecklistItem } from "./tools/add-checklist-item.js";
import { registerListChecklist } from "./tools/list-checklist.js";
import { registerReportTaskProgress } from "./tools/report-task-progress.js";
import { registerBlockTask } from "./tools/block-task.js";
import { registerListKnowledge } from "./tools/list-knowledge.js";
import { registerProposeKnowledge } from "./tools/propose-knowledge.js";
import { registerExplainLockConflict } from "./tools/explain-lock-conflict.js";
import type { CloudIntelligenceService } from "../cloud/cloud-intelligence-service.js";

export function createAgentMeshMcpServer(
  coordination: CoordinationService,
  manifests: ManifestService,
  approvals: ApprovalService,
  projectRoot: string,
  cloudIntelligence: CloudIntelligenceService
): McpServer {
  const server = new McpServer({
    name: "AgentMesh",
    version: "0.1.0"
  });

  registerGetStageContext(server, coordination);
  registerAddChecklistItem(server, coordination);
  registerListChecklist(server, coordination);
  registerListKnowledge(server, coordination);
  registerAcquireTask(server, coordination);
  registerHeartbeatTask(server, coordination);
  registerReportTaskProgress(server, coordination);
  registerBlockTask(server, coordination);
  registerExplainLockConflict(server, coordination, manifests, cloudIntelligence);
  registerLogCompletion(server, coordination);
  registerReindexProject(server, manifests);
  registerRunProjectCommand(server, approvals);
  registerProposeKnowledge(server, approvals);
  registerProjectManifestResource(server, manifests, projectRoot);
  return server;
}

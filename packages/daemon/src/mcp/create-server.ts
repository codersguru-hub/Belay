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

export function createAgentMeshMcpServer(
  coordination: CoordinationService,
  manifests: ManifestService,
  approvals: ApprovalService,
  projectRoot: string
): McpServer {
  const server = new McpServer({
    name: "AgentMesh",
    version: "0.1.0"
  });

  registerGetStageContext(server, coordination);
  registerAcquireTask(server, coordination);
  registerHeartbeatTask(server, coordination);
  registerLogCompletion(server, coordination);
  registerReindexProject(server, manifests);
  registerRunProjectCommand(server, approvals);
  registerProjectManifestResource(server, manifests, projectRoot);
  return server;
}

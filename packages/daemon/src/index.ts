import { createAgentMeshApp } from "./app.js";

const app = createAgentMeshApp();
const endpoint = await app.start();

process.stdout.write(`AgentMesh MCP listening at ${endpoint.mcpUrl}\n`);
process.stdout.write(`State database: ${app.config.databasePath}\n`);
process.stdout.write(`Project root: ${app.config.projectRoot}\n`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await app.close();
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

export { createAgentMeshApp } from "./app.js";
export { CoordinationService } from "./coordination/coordination-service.js";
export { openStateDatabase } from "./db/connection.js";
export { migrateDatabase } from "./db/migrate.js";
export { bootstrapProject } from "./db/repositories/project-repository.js";


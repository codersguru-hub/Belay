import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const PortSchema = z.coerce.number().int().min(0).max(65535);

export interface AgentMeshConfig {
  host: "127.0.0.1";
  port: number;
  stateDirectory: string;
  databasePath: string;
  projectRoot: string;
  cloudServiceUrl: string | null;
}

export function loadConfig(
  overrides: Partial<Pick<AgentMeshConfig, "port" | "stateDirectory" | "projectRoot" | "cloudServiceUrl">> = {}
): AgentMeshConfig {
  const stateDirectory = resolve(
    overrides.stateDirectory ?? process.env.AGENTMESH_STATE_DIR ?? resolve(homedir(), ".agentmesh")
  );
  const projectRoot = resolve(
    overrides.projectRoot ??
      process.env.AGENTMESH_PROJECT_ROOT ??
      process.env.INIT_CWD ??
      process.cwd()
  );
  const port = PortSchema.parse(overrides.port ?? process.env.AGENTMESH_PORT ?? 3420);

  return {
    host: "127.0.0.1",
    port,
    stateDirectory,
    databasePath: resolve(stateDirectory, "state.db"),
    projectRoot,
    cloudServiceUrl: overrides.cloudServiceUrl ?? process.env.AGENTMESH_CLOUD_URL ?? null
  };
}

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const PortSchema = z.coerce.number().int().min(0).max(65535);
const WorkspaceNameSchema = z.string().trim().min(1).max(200);

export const ProjectConfigFileSchema = z
  .object({
    port: PortSchema.optional(),
    stateDirectory: z.string().trim().min(1).optional(),
    cloudServiceUrl: z.string().trim().url().optional(),
    workspaceName: WorkspaceNameSchema.optional(),
    ageBinaryPath: z.string().trim().min(1).optional()
  })
  .strict();

export type ProjectConfigFile = z.infer<typeof ProjectConfigFileSchema>;

export interface AgentMeshConfig {
  host: "127.0.0.1";
  port: number;
  stateDirectory: string;
  databasePath: string;
  projectRoot: string;
  cloudServiceUrl: string | null;
  workspaceName: string | null;
  ageBinaryPath: string | null;
  configFilePath: string | null;
}

function tryReadConfigFile(projectRoot: string): { config: ProjectConfigFile; filePath: string } | null {
  const candidateNames = [
    resolve(projectRoot, ".agentmesh", "config.json"),
    resolve(projectRoot, "agentmesh.config.json"),
    resolve(projectRoot, ".agentmesh.json")
  ];

  for (const candidate of candidateNames) {
    if (existsSync(candidate)) {
      try {
        const rawContent = readFileSync(candidate, "utf8");
        const parsed = JSON.parse(rawContent);
        const validated = ProjectConfigFileSchema.parse(parsed);
        return { config: validated, filePath: candidate };
      } catch (error) {
        process.stderr.write(`[AgentMesh] Warning: Failed to parse config file at ${candidate}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
  return null;
}

export function loadConfig(
  overrides: Partial<
    Pick<
      AgentMeshConfig,
      | "port"
      | "stateDirectory"
      | "projectRoot"
      | "cloudServiceUrl"
      | "workspaceName"
      | "ageBinaryPath"
    >
  > = {}
): AgentMeshConfig {
  const projectRoot = resolve(
    overrides.projectRoot ??
      process.env.AGENTMESH_PROJECT_ROOT ??
      process.env.INIT_CWD ??
      process.cwd()
  );

  const fileConfigResult = tryReadConfigFile(projectRoot);
  const fileConfig = fileConfigResult?.config;

  const rawStateDirectory =
    overrides.stateDirectory ??
    process.env.AGENTMESH_STATE_DIR ??
    fileConfig?.stateDirectory ??
    resolve(homedir(), ".agentmesh");
  const stateDirectory = resolve(rawStateDirectory);

  let rawPort: unknown = overrides.port;
  if (rawPort === undefined && process.env.AGENTMESH_PORT !== undefined) {
    rawPort = process.env.AGENTMESH_PORT;
  }
  if (rawPort === undefined && fileConfig?.port !== undefined) {
    rawPort = fileConfig.port;
  }
  const port = PortSchema.parse(rawPort ?? 3420);

  const configuredWorkspace =
    overrides.workspaceName ??
    process.env.AGENTMESH_WORKSPACE ??
    fileConfig?.workspaceName ??
    null;

  const cloudServiceUrl =
    overrides.cloudServiceUrl ??
    process.env.AGENTMESH_CLOUD_URL ??
    fileConfig?.cloudServiceUrl ??
    null;

  const ageBinaryPath =
    overrides.ageBinaryPath ??
    process.env.AGENTMESH_AGE_BIN ??
    fileConfig?.ageBinaryPath ??
    null;

  return {
    host: "127.0.0.1",
    port,
    stateDirectory,
    databasePath: resolve(stateDirectory, "state.db"),
    projectRoot,
    cloudServiceUrl,
    workspaceName: configuredWorkspace ? WorkspaceNameSchema.parse(configuredWorkspace) : null,
    ageBinaryPath,
    configFilePath: fileConfigResult?.filePath ?? null
  };
}

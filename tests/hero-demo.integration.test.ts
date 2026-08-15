import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CloudSummaryRequestV1,
  CloudSummaryResponse,
  EnvironmentSchemaV1
} from "@agentmesh/contracts";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createAgentMeshApp, type AgentMeshApp } from "../packages/daemon/src/app.js";
import { CloudIntelligenceService } from "../packages/daemon/src/cloud/cloud-intelligence-service.js";
import type { CloudSummaryAdapter } from "../packages/daemon/src/cloud/cloud-run-adapter.js";
import { EgressGuard, EgressRejectedError } from "../packages/daemon/src/cloud/egress-guard.js";
import type { CommandTemplate } from "../packages/daemon/src/executor/command-registry.js";
import type {
  KeyWrapAdapter,
  RecipientMetadata
} from "../packages/daemon/src/vault/age-cli-adapter.js";

class DemoKeyWrapAdapter implements KeyWrapAdapter {
  private readonly key = createHash("sha256").update("agentmesh-hero-demo-wrap").digest();

  inspectRecipient(): RecipientMetadata {
    return {
      type: "ssh-ed25519",
      fingerprint: `sha256:${createHash("sha256").update("agentmesh-hero-demo").digest("hex")}`
    };
  }

  wrapDek(dek: Buffer): Buffer {
    return Buffer.from(dek.map((byte, index) => byte ^ (this.key[index] ?? 0)));
  }

  unwrapDek(wrappedDek: Buffer): Buffer {
    return Buffer.from(wrappedDek.map((byte, index) => byte ^ (this.key[index] ?? 0)));
  }
}

interface ConnectedClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

async function connectClient(url: string, name: string): Promise<ConnectedClient> {
  const client = new Client({ name, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return { client, transport };
}

function collectFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort();
}

function canaryVariants(canary: string): string[] {
  const bytes = Buffer.from(canary, "utf8");
  return [
    canary,
    bytes.toString("base64"),
    bytes.toString("base64url"),
    bytes.toString("hex"),
    encodeURIComponent(canary)
  ];
}

function commandTemplates(scriptPath: string, markerPath: string): CommandTemplate[] {
  const common = {
    executable: process.execPath,
    displayExecutable: "node",
    argumentMode: "none" as const,
    minimumArguments: 0,
    maximumArguments: 0,
    defaultWorkingDirectory: ".",
    allowedWorkingDirectories: ["."],
    environmentProfile: "demo",
    environmentVariableNames: ["DB_PASSWORD"],
    inheritedEnvironmentVariableNames: [],
    timeoutMilliseconds: 5_000,
    maxOutputBytes: 16_384
  };
  return [
    {
      ...common,
      id: "demo-secret-test",
      fixedArguments: [scriptPath, "secret"],
      policyClass: "auto_allow"
    },
    {
      ...common,
      id: "demo-staging-reload",
      fixedArguments: [scriptPath, "approval", markerPath],
      policyClass: "approval_required",
      targetAlias: "staging-api",
      policyReason: "Reloading staging changes a protected runtime.",
      policyVersion: "hero-demo-v1",
      approvalTtlMilliseconds: 5 * 60 * 1000
    }
  ];
}

describe("integrated AgentMesh hero flow", () => {
  it("proves deterministic context, collision prevention, zero-leak execution, approval, cloud egress, and restart recovery", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "agentmesh-hero-"));
    const projectRoot = join(sandbox, "demo-repo");
    const stateDirectory = join(sandbox, "state");
    const sourceDirectory = join(projectRoot, "src");
    const markerPath = join(sandbox, "approved.marker");
    const commandPath = join(projectRoot, "demo-command.mjs");
    const vaultPath = join(projectRoot, ".env.vault");
    const schemaPath = join(projectRoot, ".env.schema.json");
    const canary = `AGENTMESH_${randomUUID()}_S3cret+/=`;
    const captures: Record<string, unknown> = {};
    let app: AgentMeshApp | undefined;
    let restarted: AgentMeshApp | undefined;
    let codex: ConnectedClient | undefined;
    let claude: ConnectedClient | undefined;
    let recoveryClient: ConnectedClient | undefined;
    let socket: WebSocket | undefined;

    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(
      join(projectRoot, "package.json"),
      `${JSON.stringify({
        name: "agentmesh-hero-demo",
        private: true,
        scripts: { build: "tsc", test: "vitest run", dev: "vite --port 5173" },
        dependencies: { "@modelcontextprotocol/server": "2.0.0", vite: "8.0.0" }
      }, null, 2)}\n`
    );
    writeFileSync(
      join(sourceDirectory, "schema.ts"),
      "export interface HeroContract { readonly id: string; }\n"
    );
    writeFileSync(
      join(sourceDirectory, "api.ts"),
      'import type { HeroContract } from "./schema.js";\nexport const load = (id: string): HeroContract => ({ id });\n'
    );
    writeFileSync(
      commandPath,
      `import { writeFileSync } from "node:fs";
const mode = process.argv[2];
const secret = process.env.DB_PASSWORD ?? "";
if (mode === "secret") {
  const middle = Math.floor(secret.length / 2);
  process.stdout.write(secret.slice(0, middle));
  setTimeout(() => {
    process.stdout.write(secret.slice(middle) + "\\n");
    process.stderr.write(Buffer.from(secret).toString("base64") + "\\n");
    process.stdout.write(Buffer.from(secret).toString("base64url") + "\\n");
    process.stdout.write(Buffer.from(secret).toString("hex") + "\\n");
    process.stdout.write(encodeURIComponent(secret) + "\\n");
  }, 10);
} else if (mode === "approval") {
  writeFileSync(process.argv[3], "approved-once");
  process.stdout.write("staging reload completed\\n");
}
`
    );

    try {
      const templates = commandTemplates(commandPath, markerPath);
      app = createAgentMeshApp({
        projectRoot,
        stateDirectory,
        port: 0,
        keyWrapAdapter: new DemoKeyWrapAdapter(),
        commandTemplates: templates,
        leaseSweepIntervalMilliseconds: 0
      });
      const endpoint = await app.start();
      codex = await connectClient(endpoint.mcpUrl, "codex-hero");
      claude = await connectClient(endpoint.mcpUrl, "claude-hero");

      const firstManifest = await codex.client.readResource({ uri: "project://manifest" });
      const firstManifestText = String(firstManifest.contents[0]?.text ?? "");
      const indexedAgain = app.manifests.indexProject(projectRoot);
      const indexedThird = app.manifests.indexProject(projectRoot);
      expect(indexedAgain.canonicalJson).toBe(firstManifestText);
      expect(indexedThird.canonicalJson).toBe(firstManifestText);
      expect(indexedThird.estimatedTokens).toBeLessThanOrEqual(800);
      expect(Math.max(indexedAgain.durationMs, indexedThird.durationMs)).toBeLessThan(100);
      captures.manifest = JSON.parse(firstManifestText) as unknown;

      const contenders = [
        { client: codex.client, taskId: "hero-codex", agentName: "codex", key: "hero-codex-001" },
        { client: claude.client, taskId: "hero-claude", agentName: "claude", key: "hero-claude-001" }
      ];
      const acquisitions = await Promise.all(contenders.map((contender) =>
        contender.client.callTool({
          name: "acquire_task",
          arguments: {
            projectRoot,
            taskId: contender.taskId,
            agentName: contender.agentName,
            title: "Refactor the shared API contract",
            filePaths: ["src/schema.ts", `src/${contender.agentName}.ts`],
            leaseSeconds: 300,
            idempotencyKey: contender.key
          }
        })
      ));
      const winnerIndex = acquisitions.findIndex((result) => result.isError !== true);
      const loserIndex = acquisitions.findIndex((result) => result.isError === true);
      expect(winnerIndex).toBeGreaterThanOrEqual(0);
      expect(loserIndex).toBeGreaterThanOrEqual(0);
      const conflict = acquisitions[loserIndex]?.structuredContent as Record<string, unknown>;
      expect(conflict).toMatchObject({ ok: false, code: "LOCK_CONFLICT", retryable: true });
      expect(conflict.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
      captures.lockConflict = conflict;

      const stageContext = await contenders[loserIndex]!.client.callTool({
        name: "get_stage_context",
        arguments: { projectRoot, historyLimit: 10 }
      });
      captures.stageContext = stageContext.structuredContent;
      expect(stageContext.structuredContent).toEqual(expect.objectContaining({
        ok: true,
        activeTasks: [expect.objectContaining({ lockedFiles: expect.arrayContaining(["src/schema.ts"]) })]
      }));

      const winner = contenders[winnerIndex]!;
      const completion = await winner.client.callTool({
        name: "log_completion",
        arguments: {
          projectRoot,
          taskId: winner.taskId,
          agentName: winner.agentName,
          summary: "Shared contract refactor completed.",
          modifiedFiles: ["src/schema.ts", `src/${winner.agentName}.ts`]
        }
      });
      expect(completion.isError).not.toBe(true);
      captures.completion = completion.structuredContent;

      const schema: EnvironmentSchemaV1 = {
        format: "agentmesh-env-schema",
        version: 1,
        profile: "demo",
        variables: [{ name: "DB_PASSWORD", required: true, description: "Demo database credential" }]
      };
      app.vault.createVault({
        vaultPath,
        schemaPath,
        recipientPublicKeyPath: join(sandbox, "recipient.pub"),
        schema,
        values: { DB_PASSWORD: canary }
      });
      app.vault.unlockVault({
        vaultPath,
        schemaPath,
        identityPath: join(sandbox, "identity")
      });

      const secretRun = await codex.client.callTool({
        name: "run_project_command",
        arguments: {
          projectRoot,
          commandId: "demo-secret-test",
          arguments: [],
          environmentProfile: "demo",
          requester: "codex"
        }
      });
      expect(secretRun.isError).not.toBe(true);
      expect(JSON.stringify(secretRun.structuredContent)).toContain("[REDACTED]");
      captures.secretBackedMcp = secretRun.structuredContent;

      const pendingResult = await claude.client.callTool({
        name: "run_project_command",
        arguments: {
          projectRoot,
          commandId: "demo-staging-reload",
          arguments: [],
          environmentProfile: "demo",
          requester: "Claude Code"
        }
      });
      const pending = pendingResult.structuredContent as {
        approvalId: string;
        actionDigest: string;
        status: string;
        environmentVariableNames: string[];
      };
      expect(pending).toMatchObject({
        status: "pending",
        environmentVariableNames: ["DB_PASSWORD"]
      });
      expect(existsSync(markerPath)).toBe(false);
      captures.pendingMcp = pending;

      const project = app.database.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
      const pendingResponse = await fetch(
        `http://${endpoint.host}:${endpoint.port}/api/projects/${project.id}/approvals?status=pending`
      );
      captures.pendingRest = await pendingResponse.json();
      expect(JSON.stringify(captures.pendingRest)).not.toContain(canary);

      const protocol = `agentmesh-token.${app.dashboardSessionToken}`;
      socket = new WebSocket(`ws://${endpoint.host}:${endpoint.port}/events`, protocol);
      await new Promise<void>((resolvePromise, reject) => {
        socket!.addEventListener("open", () => resolvePromise(), { once: true });
        socket!.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
      });
      const eventPromise = new Promise<Record<string, unknown>>((resolvePromise) => {
        socket!.addEventListener("message", (event) => {
          resolvePromise(JSON.parse(String(event.data)) as Record<string, unknown>);
        }, { once: true });
      });
      const approvalUrl = `http://${endpoint.host}:${endpoint.port}/api/approvals/${pending.approvalId}/decision`;
      const approvalBody = JSON.stringify({
        decision: "approve",
        expectedDigest: pending.actionDigest,
        reason: "Verified immutable demo action"
      });
      const approvedResponse = await fetch(approvalUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${app.dashboardSessionToken}`
        },
        body: approvalBody
      });
      expect(approvedResponse.status).toBe(200);
      captures.approvalRest = await approvedResponse.json();
      captures.approvalWebSocket = await eventPromise;
      expect(readFileSync(markerPath, "utf8")).toBe("approved-once");

      const replayResponse = await fetch(approvalUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${app.dashboardSessionToken}`
        },
        body: approvalBody
      });
      expect(replayResponse.status).toBe(409);
      captures.approvalReplay = await replayResponse.json();
      expect(captures.approvalReplay).toEqual(expect.objectContaining({
        ok: false,
        code: "APPROVAL_CONFLICT",
        correlationId: expect.any(String)
      }));
      expect(readFileSync(markerPath, "utf8")).toBe("approved-once");

      const dashboardResponse = await fetch(`http://${endpoint.host}:${endpoint.port}/api/dashboard`);
      captures.dashboardRest = await dashboardResponse.json();
      const auditResponse = await fetch(
        `http://${endpoint.host}:${endpoint.port}/api/projects/${project.id}/audit`
      );
      captures.auditRest = await auditResponse.json();

      let cloudCalls = 0;
      let allowedCloudFixture: CloudSummaryRequestV1 | undefined;
      const cloudAdapter: CloudSummaryAdapter = {
        provider: "verified-cloud-run-fixture",
        async summarize(payload, options): Promise<CloudSummaryResponse> {
          cloudCalls += 1;
          allowedCloudFixture = payload;
          return {
            requestId: options.requestId,
            model: "gemini-3.6-flash",
            summary: "Structural metadata indicates a small TypeScript MCP service.",
            riskLevel: "low",
            generatedAt: "2026-08-15T15:00:00.000Z"
          };
        }
      };
      app.manifests.indexProject(projectRoot);
      const cloud = new CloudIntelligenceService(
        app.database,
        app.manifests,
        app.vault,
        projectRoot,
        cloudAdapter,
        { createRequestId: () => "723e4567-e89b-42d3-a456-426614174000" }
      );
      captures.cloudResponse = await cloud.summarizeManifest();
      captures.allowedCloudFixture = allowedCloudFixture;
      expect(cloudCalls).toBe(1);

      const forbidden = {
        version: 1,
        kind: "manifest_summary",
        projectAlias: canary,
        manifest: {
          frameworks: ["typescript"],
          scripts: ["test"],
          ports: [],
          topology: [],
          git: { branch: "main", dirtyFileCount: 0 }
        }
      };
      expect(() => new EgressGuard([canary]).inspect(forbidden)).toThrow(EgressRejectedError);
      expect(cloudCalls).toBe(1);
      captures.forbiddenEgress = {
        ok: false,
        code: "FORBIDDEN_CONTENT",
        correlationId: randomUUID(),
        message: "Cloud egress rejected before network invocation."
      };

      const durable = await codex.client.callTool({
        name: "acquire_task",
        arguments: {
          projectRoot,
          taskId: "hero-restart-task",
          agentName: "antigravity",
          title: "Survive daemon restart",
          filePaths: ["src/api.ts"],
          leaseSeconds: 300,
          idempotencyKey: "hero-restart-001"
        }
      });
      expect(durable.isError).not.toBe(true);

      await codex.client.close();
      codex = undefined;
      await claude.client.close();
      claude = undefined;
      socket.close();
      socket = undefined;
      await app.close();
      app = undefined;

      restarted = createAgentMeshApp({
        projectRoot,
        stateDirectory,
        port: 0,
        keyWrapAdapter: new DemoKeyWrapAdapter(),
        commandTemplates: templates,
        leaseSweepIntervalMilliseconds: 0
      });
      const recoveredEndpoint = await restarted.start();
      recoveryClient = await connectClient(recoveredEndpoint.mcpUrl, "recovery-hero");
      const recovered = await recoveryClient.client.callTool({
        name: "get_stage_context",
        arguments: { projectRoot, historyLimit: 20 }
      });
      captures.recoveredMcp = recovered.structuredContent;
      expect(recovered.structuredContent).toEqual(expect.objectContaining({
        ok: true,
        activeTasks: [expect.objectContaining({ id: "hero-restart-task", agentName: "antigravity" })]
      }));
      await recoveryClient.client.close();
      recoveryClient = undefined;
      await restarted.close();
      restarted = undefined;

      const evidencePath = join(sandbox, "sanitized-demo-captures.json");
      writeFileSync(evidencePath, `${JSON.stringify(captures, null, 2)}\n`, "utf8");
      const variants = canaryVariants(canary);
      const scannedFiles = collectFiles(sandbox);
      for (const file of scannedFiles) {
        const bytes = readFileSync(file);
        for (const variant of variants) {
          expect(bytes.includes(Buffer.from(variant, "utf8")), `${file} leaked a canary variant`).toBe(false);
        }
      }
      expect(JSON.stringify(captures)).not.toContain(app?.dashboardSessionToken ?? "never-present");

      console.log(JSON.stringify({
        manifest: {
          version: indexedThird.version,
          bytes: indexedThird.byteSize,
          estimatedTokens: indexedThird.estimatedTokens,
          warmIndexMs: indexedThird.durationMs
        },
        coordination: { contenders: 2, winners: 1, conflicts: 1, restartRecovered: true },
        vault: { injectedInMemory: true, mcpOutputRedacted: true },
        approval: { intercepted: true, executedOnce: true, replayBlocked: true },
        cloud: { allowedCalls: cloudCalls, forbiddenCalls: 0, model: "gemini-3.6-flash" },
        leakScan: { files: scannedFiles.length, variants: variants.length, clean: true }
      }, null, 2));
    } finally {
      socket?.close();
      await Promise.allSettled([
        codex?.client.close(),
        claude?.client.close(),
        recoveryClient?.client.close(),
        app?.close(),
        restarted?.close()
      ].filter((value): value is Promise<void> => value !== undefined));
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 30_000);
});

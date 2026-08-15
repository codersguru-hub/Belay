import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EnvironmentSchemaV1 } from "@agentmesh/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentMeshApp, type AgentMeshApp } from "../packages/daemon/src/app.js";
import type {
  CommandTemplate
} from "../packages/daemon/src/executor/command-registry.js";
import { SecretRedactor } from "../packages/daemon/src/executor/secret-redactor.js";
import type {
  KeyWrapAdapter,
  RecipientMetadata
} from "../packages/daemon/src/vault/age-cli-adapter.js";

const CANARY = "S3cret+/= value?&_9c17e45b2a";
const cleanupDirectories: string[] = [];
const cleanupApps: AgentMeshApp[] = [];

class TestKeyWrapAdapter implements KeyWrapAdapter {
  private readonly key = createHash("sha256").update("executor-test-wrap").digest();

  inspectRecipient(): RecipientMetadata {
    return {
      type: "ssh-ed25519",
      fingerprint: `sha256:${createHash("sha256").update("executor-test").digest("hex")}`
    };
  }

  wrapDek(dek: Buffer): Buffer {
    return Buffer.from(dek.map((byte, index) => byte ^ (this.key[index] ?? 0)));
  }

  unwrapDek(wrappedDek: Buffer): Buffer {
    return Buffer.from(wrappedDek.map((byte, index) => byte ^ (this.key[index] ?? 0)));
  }
}

function template(
  id: string,
  scriptPath: string,
  mode: string,
  overrides: Partial<CommandTemplate> = {}
): CommandTemplate {
  return {
    id,
    executable: process.execPath,
    displayExecutable: "node",
    fixedArguments: [scriptPath, mode],
    argumentMode: "none",
    minimumArguments: 0,
    maximumArguments: 0,
    defaultWorkingDirectory: ".",
    allowedWorkingDirectories: ["."],
    environmentVariableNames: [],
    inheritedEnvironmentVariableNames: [],
    policyClass: "auto_allow",
    timeoutMilliseconds: 2_000,
    maxOutputBytes: 16_384,
    ...overrides
  };
}

function fixture(): {
  app: AgentMeshApp;
  root: string;
  stateDirectory: string;
  vaultPath: string;
  schemaPath: string;
  markerPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "agentmesh-executor-"));
  cleanupDirectories.push(root);
  const stateDirectory = join(root, ".agentmesh-state");
  const scriptPath = join(root, "command-fixture.mjs");
  const markerPath = join(root, "spawned.marker");
  mkdirSync(join(root, "nested"));
  writeFileSync(
    scriptPath,
    `import { writeFileSync } from "node:fs";
const mode = process.argv[2];
const secret = process.env.DB_PASSWORD ?? "";
if (mode === "leak") {
  const half = Math.floor(secret.length / 2);
  process.stdout.write(secret.slice(0, half));
  setTimeout(() => {
    process.stdout.write(secret.slice(half) + "\\n");
    process.stderr.write(Buffer.from(secret).toString("base64") + "\\n");
    process.stdout.write(Buffer.from(secret).toString("base64url") + "\\n");
    process.stdout.write(encodeURIComponent(secret) + "\\n");
    process.stdout.write(Buffer.from(secret).toString("hex") + "\\n");
  }, 10);
} else if (mode === "marker") {
  writeFileSync(process.argv[3], "spawned");
} else if (mode === "timeout") {
  setTimeout(() => process.stdout.write("late"), 5000);
} else if (mode === "output") {
  process.stdout.write("x".repeat(4096));
}
`,
    "utf8"
  );
  const templates: CommandTemplate[] = [
    template("leak-test", scriptPath, "leak", {
      environmentProfile: "test",
      environmentVariableNames: ["DB_PASSWORD"]
    }),
    template("argument-test", scriptPath, "marker", {
      fixedArguments: [scriptPath, "marker", markerPath],
      argumentMode: "safe_tokens",
      maximumArguments: 1
    }),
    template("timeout-test", scriptPath, "timeout", { timeoutMilliseconds: 100 }),
    template("output-test", scriptPath, "output", { maxOutputBytes: 256 })
  ];
  const app = createAgentMeshApp({
    projectRoot: root,
    stateDirectory,
    keyWrapAdapter: new TestKeyWrapAdapter(),
    commandTemplates: templates
  });
  cleanupApps.push(app);
  return {
    app,
    root,
    stateDirectory,
    vaultPath: join(root, ".env.vault"),
    schemaPath: join(root, ".env.schema.json"),
    markerPath
  };
}

function unlockCanaryVault(f: ReturnType<typeof fixture>): void {
  const schema: EnvironmentSchemaV1 = {
    format: "agentmesh-env-schema",
    version: 1,
    profile: "test",
    variables: [{ name: "DB_PASSWORD", required: true, description: "test secret" }]
  };
  f.app.vault.createVault({
    vaultPath: f.vaultPath,
    schemaPath: f.schemaPath,
    recipientPublicKeyPath: join(f.root, "recipient.pub"),
    schema,
    values: { DB_PASSWORD: CANARY }
  });
  f.app.vault.unlockVault({
    vaultPath: f.vaultPath,
    schemaPath: f.schemaPath,
    identityPath: join(f.root, "identity")
  });
}

afterEach(async () => {
  for (const app of cleanupApps.splice(0)) await app.close();
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("registered command executor security", () => {
  it("redacts split raw secrets and encoded variants without persisting the canary", async () => {
    const f = fixture();
    unlockCanaryVault(f);
    const result = await f.app.executor.run({
      projectRoot: f.root,
      commandId: "leak-test",
      arguments: [],
      environmentProfile: "test"
    });
    expect(result.status).toBe("succeeded");
    expect(`${result.stdout}${result.stderr}`).toContain("[REDACTED]");
    const variants = [
      CANARY,
      Buffer.from(CANARY).toString("base64"),
      Buffer.from(CANARY).toString("base64url"),
      encodeURIComponent(CANARY),
      Buffer.from(CANARY).toString("hex")
    ];
    for (const variant of variants) expect(JSON.stringify(result)).not.toContain(variant);

    const capturePath = join(f.root, "mcp-capture.json");
    writeFileSync(capturePath, JSON.stringify(result), "utf8");
    const rows = f.app.database.prepare("SELECT * FROM command_runs").all();
    expect(JSON.stringify(rows)).not.toContain(CANARY);
    expect(readFileSync(f.vaultPath, "utf8")).not.toContain(CANARY);
    expect(readFileSync(f.schemaPath, "utf8")).not.toContain(CANARY);
    expect(readFileSync(capturePath, "utf8")).not.toContain(CANARY);
  });

  it("rejects shell arguments and working-directory escapes before spawn", async () => {
    const f = fixture();
    await expect(
      f.app.executor.run({
        projectRoot: f.root,
        commandId: "argument-test",
        arguments: ["ok;whoami"]
      })
    ).rejects.toMatchObject({ code: "COMMAND_REJECTED" });
    expect(existsSync(f.markerPath)).toBe(false);
    await expect(
      f.app.executor.run({
        projectRoot: f.root,
        commandId: "argument-test",
        arguments: [],
        workingDirectory: "nested"
      })
    ).rejects.toMatchObject({ code: "COMMAND_REJECTED" });
    expect(existsSync(f.markerPath)).toBe(false);
    const rejected = f.app.database
      .prepare("SELECT arguments_json, executable_alias, status FROM command_runs")
      .all();
    expect(rejected).toEqual([
      { arguments_json: "[]", executable_alias: "[rejected]", status: "rejected" },
      { arguments_json: "[]", executable_alias: "[rejected]", status: "rejected" }
    ]);
  });

  it("fails closed when the vault is locked", async () => {
    const f = fixture();
    await expect(
      f.app.executor.run({
        projectRoot: f.root,
        commandId: "leak-test",
        arguments: [],
        environmentProfile: "test"
      })
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });
  });

  it("reports explicit timeout and output truncation states", async () => {
    const f = fixture();
    const timedOut = await f.app.executor.run({
      projectRoot: f.root,
      commandId: "timeout-test",
      arguments: []
    });
    expect(timedOut.status).toBe("timed_out");
    const truncated = await f.app.executor.run({
      projectRoot: f.root,
      commandId: "output-test",
      arguments: []
    });
    expect(truncated).toMatchObject({ status: "output_truncated", outputTruncated: true });
    expect(truncated.outputBytes).toBeLessThanOrEqual(256);
  });

  it("holds incomplete encoded patterns across arbitrary stream boundaries", () => {
    const redactor = new SecretRedactor([CANARY]);
    const stream = redactor.createStream();
    const encoded = Buffer.from(CANARY).toString("base64");
    const output =
      stream.write(Buffer.from(encoded.slice(0, 3))) +
      stream.write(Buffer.from(encoded.slice(3, 11))) +
      stream.write(Buffer.from(encoded.slice(11))) +
      stream.end();
    expect(output).toBe("[REDACTED]");
  });
});

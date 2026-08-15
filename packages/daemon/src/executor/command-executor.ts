import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CommandExecutionResult,
  CommandRunStatus,
  RunProjectCommandInput
} from "@agentmesh/contracts";
import { CoordinationError } from "../coordination/errors.js";
import {
  canonicalizeProjectRoot,
  findProjectByRoot,
  type ProjectRow
} from "../db/repositories/project-repository.js";
import {
  finishCommandRun,
  insertCommandRun,
  insertRejectedCommandRun
} from "../db/repositories/command-run-repository.js";
import { VaultError } from "../vault/errors.js";
import type { VaultService } from "../vault/vault-service.js";
import { CommandRegistry, type ValidatedCommandPlan } from "./command-registry.js";
import { SecretRedactor } from "./secret-redactor.js";

export interface CommandExecutorOptions {
  now?: () => Date;
  createId?: () => string;
  monotonicMilliseconds?: () => number;
}

interface CapturedExecution {
  status: CommandRunStatus;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputBytes: number;
  outputTruncated: boolean;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class CommandExecutor {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly monotonicMilliseconds: () => number;

  constructor(
    private readonly database: Database.Database,
    private readonly vault: VaultService,
    private readonly registry: CommandRegistry,
    options: CommandExecutorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.monotonicMilliseconds = options.monotonicMilliseconds ?? (() => performance.now());
  }

  async run(input: RunProjectCommandInput): Promise<CommandExecutionResult> {
    return this.runInternal(input, false);
  }

  async runApproved(input: RunProjectCommandInput): Promise<CommandExecutionResult> {
    return this.runInternal(input, true);
  }

  private async runInternal(
    input: RunProjectCommandInput,
    allowApprovalRequired: boolean
  ): Promise<CommandExecutionResult> {
    const correlationId = this.createId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const template = this.registry.get(input.commandId);
    if (!template) {
      this.reject(project, input.commandId, correlationId);
      throw new CoordinationError({
        code: "COMMAND_NOT_FOUND",
        message: "The requested command is not registered.",
        correlationId
      });
    }

    let plan: ValidatedCommandPlan;
    try {
      plan = this.registry.validatePlan(
        template,
        project.canonical_root,
        input.arguments,
        input.workingDirectory
      );
    } catch {
      this.reject(project, template.id, correlationId);
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "The command request violates its registered policy.",
        correlationId
      });
    }

    if (
      template.policyClass !== "auto_allow" &&
      !(allowApprovalRequired && template.policyClass === "approval_required")
    ) {
      this.reject(project, template.id, correlationId);
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "This command is not eligible for automatic execution.",
        correlationId
      });
    }
    if (template.environmentProfile !== input.environmentProfile) {
      this.reject(project, template.id, correlationId);
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "The environment profile does not match the registered command.",
        correlationId
      });
    }

    if (template.environmentVariableNames.length === 0) {
      return this.execute(project, plan, {}, correlationId);
    }
    const status = this.vault.status();
    if (status.state !== "unlocked") {
      this.reject(project, template.id, correlationId);
      throw new CoordinationError({
        code: "VAULT_LOCKED",
        message: "The registered environment vault is locked.",
        correlationId
      });
    }
    if (status.profile !== template.environmentProfile) {
      this.reject(project, template.id, correlationId);
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "The unlocked vault profile does not match the registered command.",
        correlationId
      });
    }

    try {
      return await this.vault.withUnlockedEnvironment(
        template.environmentVariableNames,
        (environment) => this.execute(project, plan, environment, correlationId)
      );
    } catch (error) {
      if (error instanceof CoordinationError) throw error;
      if (error instanceof VaultError) {
        this.reject(project, template.id, correlationId);
        throw new CoordinationError({
          code: error.code === "VAULT_LOCKED" ? "VAULT_LOCKED" : "COMMAND_REJECTED",
          message: "The registered environment could not be prepared.",
          correlationId
        });
      }
      throw error;
    }
  }

  private resolveProject(projectRoot: string, correlationId: string): ProjectRow {
    try {
      const canonicalRoot = canonicalizeProjectRoot(projectRoot);
      const project = findProjectByRoot(this.database, canonicalRoot);
      if (project) return project;
    } catch {
      // Normalized below so filesystem details are not exposed through MCP.
    }
    throw new CoordinationError({
      code: "PROJECT_NOT_FOUND",
      message: "The project has not been initialized in AgentMesh.",
      correlationId
    });
  }

  private reject(project: ProjectRow, commandId: string, correlationId: string): void {
    const startedAt = this.now().toISOString();
    insertRejectedCommandRun(this.database, {
      id: this.createId(),
      projectId: project.id,
      commandId: /^[a-z][a-z0-9._-]{0,79}$/u.test(commandId) ? commandId : "invalid",
      startedAt,
      correlationId
    });
  }

  private async execute(
    project: ProjectRow,
    plan: ValidatedCommandPlan,
    secretEnvironment: Readonly<Record<string, string>>,
    correlationId: string
  ): Promise<CommandExecutionResult> {
    let redactor: SecretRedactor;
    try {
      redactor = new SecretRedactor(Object.values(secretEnvironment));
    } catch {
      this.reject(project, plan.template.id, correlationId);
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "A registered secret cannot be redacted safely.",
        correlationId
      });
    }

    const runId = this.createId();
    const startedAt = this.now().toISOString();
    const startTick = this.monotonicMilliseconds();
    const spawnArguments = [...plan.template.fixedArguments, ...plan.arguments];
    const sanitizedArguments = spawnArguments.map((argument) => redactor.redactText(argument));
    const environmentNames = [...plan.template.environmentVariableNames].sort();
    insertCommandRun(this.database, {
      id: runId,
      projectId: project.id,
      commandId: plan.template.id,
      executableAlias: plan.template.displayExecutable,
      arguments: sanitizedArguments,
      workingDirectory: plan.displayWorkingDirectory,
      environmentNames,
      policyClass: plan.template.policyClass,
      startedAt,
      correlationId
    });

    const environment: NodeJS.ProcessEnv = {};
    for (const name of plan.template.inheritedEnvironmentVariableNames ?? []) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
    if (process.platform === "win32") {
      for (const name of ["SystemRoot", "WINDIR"]) {
        const value = process.env[name];
        if (value !== undefined) environment[name] = value;
      }
    }
    Object.assign(environment, secretEnvironment);

    const captured = await this.captureProcess(
      plan,
      spawnArguments,
      environment,
      redactor
    );
    for (const name of Object.keys(environment)) {
      environment[name] = "";
      delete environment[name];
    }
    const completedAt = this.now().toISOString();
    const durationMs = Math.max(0, Math.round(this.monotonicMilliseconds() - startTick));
    finishCommandRun(this.database, {
      id: runId,
      status: captured.status,
      completedAt,
      durationMilliseconds: durationMs,
      exitCode: captured.exitCode,
      signal: captured.signal,
      outputBytes: captured.outputBytes,
      outputTruncated: captured.outputTruncated,
      stdoutSha256: digest(captured.stdout),
      stderrSha256: digest(captured.stderr)
    });

    return {
      ok: true,
      runId,
      commandId: plan.template.id,
      executable: plan.template.displayExecutable,
      arguments: sanitizedArguments,
      workingDirectory: plan.displayWorkingDirectory,
      policyClass: plan.template.policyClass,
      environmentVariableNames: environmentNames,
      status: captured.status,
      exitCode: captured.exitCode,
      signal: captured.signal,
      stdout: captured.stdout,
      stderr: captured.stderr,
      outputBytes: captured.outputBytes,
      outputTruncated: captured.outputTruncated,
      startedAt,
      completedAt,
      durationMs,
      correlationId
    };
  }

  private captureProcess(
    plan: ValidatedCommandPlan,
    spawnArguments: string[],
    environment: NodeJS.ProcessEnv,
    redactor: SecretRedactor
  ): Promise<CapturedExecution> {
    return new Promise((resolveResult) => {
      const stdoutRedactor = redactor.createStream();
      const stderrRedactor = redactor.createStream();
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let rawOutputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let spawnFailed = false;
      let settled = false;

      const child = spawn(plan.template.executable, spawnArguments, {
        cwd: plan.absoluteWorkingDirectory,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stop = (): void => {
        if (!child.killed) child.kill();
      };
      const append = (target: "stdout" | "stderr", value: string): void => {
        if (!value) return;
        const bytes = Buffer.byteLength(value, "utf8");
        const remaining = Math.max(0, plan.template.maxOutputBytes - outputBytes);
        if (bytes > remaining) {
          const safePrefix = Buffer.from(value, "utf8").subarray(0, remaining).toString("utf8");
          if (target === "stdout") stdout += safePrefix;
          else stderr += safePrefix;
          outputBytes += Buffer.byteLength(safePrefix, "utf8");
          truncated = true;
          stop();
          return;
        }
        if (target === "stdout") stdout += value;
        else stderr += value;
        outputBytes += bytes;
      };
      const consume = (
        target: "stdout" | "stderr",
        chunk: Buffer,
        stream: ReturnType<SecretRedactor["createStream"]>
      ): void => {
        rawOutputBytes += chunk.length;
        append(target, stream.write(chunk));
        if (rawOutputBytes > plan.template.maxOutputBytes) {
          truncated = true;
          stop();
        }
      };
      child.stdout.on("data", (chunk: Buffer) => consume("stdout", chunk, stdoutRedactor));
      child.stderr.on("data", (chunk: Buffer) => consume("stderr", chunk, stderrRedactor));
      child.once("error", () => {
        spawnFailed = true;
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, plan.template.timeoutMilliseconds);
      timeout.unref();

      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        append("stdout", stdoutRedactor.end());
        append("stderr", stderrRedactor.end());
        const status: CommandRunStatus = timedOut
          ? "timed_out"
          : truncated
            ? "output_truncated"
            : spawnFailed
              ? "spawn_failed"
              : exitCode === 0
                ? "succeeded"
                : "failed";
        resolveResult({
          status,
          exitCode,
          signal,
          stdout,
          stderr,
          outputBytes,
          outputTruncated: truncated
        });
      });
    });
  }
}

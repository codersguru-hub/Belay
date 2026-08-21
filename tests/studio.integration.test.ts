import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStateDatabase } from "../packages/daemon/src/db/connection.js";
import { migrateDatabase } from "../packages/daemon/src/db/migrate.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";
import {
  CommandRegistry,
  defaultCommandTemplates,
  type CommandTemplate
} from "../packages/daemon/src/executor/command-registry.js";
import { CommandExecutor } from "../packages/daemon/src/executor/command-executor.js";
import { VaultService } from "../packages/daemon/src/vault/vault-service.js";
import { ApprovalService } from "../packages/daemon/src/approval/approval-service.js";
import { ApprovalEventHub } from "../packages/daemon/src/approval/event-hub.js";
import { PolicyEngine } from "../packages/daemon/src/approval/policy-engine.js";
import { StudioService } from "../packages/daemon/src/studio/studio-service.js";
import { frameFragmentedText } from "../packages/daemon/src/server/studio-websocket.js";

const temporaryDirectories: string[] = [];

function createStudioFixture(templates?: readonly CommandTemplate[]) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "belay-studio-test-"));
  temporaryDirectories.push(stateDirectory);
  const projectRoot = join(stateDirectory, "repo");
  mkdirSync(projectRoot);

  const { database } = openStateDatabase(join(stateDirectory, "state.db"));
  migrateDatabase(database);
  const { project } = bootstrapProject(database, projectRoot);

  const registry = new CommandRegistry(templates ?? defaultCommandTemplates());
  const vault = new VaultService({
    wrapKey: async () => ({ ciphertext: "test", recipientFingerprint: "fp" }),
    unwrapKey: async () => Buffer.from("00".repeat(32), "hex")
  });
  const executor = new CommandExecutor(database, vault, registry);
  const approvalEvents = new ApprovalEventHub();
  const approvals = new ApprovalService(database, executor, registry, new PolicyEngine(), approvalEvents);
  const studio = new StudioService(database, projectRoot, executor, approvals, approvalEvents);

  return { database, projectRoot, project, studio, approvals, approvalEvents };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // ignore EBUSY on windows during fast teardown
    }
  }
});

describe("Studio Service & WebSocket Layer", () => {
  it("creates, retrieves, and lists studio sessions with messages", async () => {
    const { studio, project } = createStudioFixture();

    const session = studio.createSession({
      projectId: project.id,
      title: "MQL5 Trade Parity Refactor",
      activeAgent: "codex"
    });

    expect(session.id).toMatch(/^session-/);
    expect(session.title).toBe("MQL5 Trade Parity Refactor");
    expect(session.activeAgent).toBe("codex");

    const sessions = studio.listSessions(project.id);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.id).toBe(session.id);

    // Dispatch prompt
    const { userMessage, assistantMessage } = await studio.dispatchPrompt(session.id, {
      targetAgent: "codex",
      prompt: "Refactor order ticket trailing stops"
    });

    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("Refactor order ticket trailing stops");
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.agentName).toBe("codex");

    const detail = studio.getSession(session.id);
    expect(detail).not.toBeNull();
    expect(detail?.messages.length).toBe(2);
    expect(detail?.messages[0]?.role).toBe("user");
    expect(detail?.messages[1]?.role).toBe("assistant");
  });

  it("gates a real agent dispatch behind human approval and never executes until decided", async () => {
    const { studio, approvals, project } = createStudioFixture();
    const session = studio.createSession({
      projectId: project.id,
      title: "Gate check",
      activeAgent: "claude"
    });

    const { assistantMessage } = await studio.dispatchPrompt(session.id, {
      targetAgent: "claude",
      prompt: "Refactor the trailing-stop handler"
    });

    // Approval-gated: no completion text, just an awaiting-approval message carrying the id.
    expect(assistantMessage.content).toMatch(/Awaiting Approval/);
    expect(assistantMessage.approvalId).toBeDefined();

    const pending = approvals.listPending(project.id);
    expect(pending.length).toBe(1);
    expect(pending[0]?.commandId).toBe("claude-dispatch");
    expect(pending[0]?.approvalId).toBe(assistantMessage.approvalId);
  });

  it("rejects an antigravity dispatch at the service layer without touching the executor or approvals", async () => {
    const { studio, approvals, project } = createStudioFixture();
    const session = studio.createSession({
      projectId: project.id,
      title: "Antigravity guard",
      activeAgent: "antigravity"
    });

    const { assistantMessage } = await studio.dispatchPrompt(session.id, {
      targetAgent: "antigravity",
      prompt: "this must never reach a real process"
    });

    expect(assistantMessage.content).toMatch(/Not Available/);
    expect(assistantMessage.approvalId).toBeUndefined();
    // Guarded before the approval funnel: no pending approval was ever created.
    expect(approvals.listPending(project.id).length).toBe(0);
  });

  it("delivers the exact prompt over stdin and folds real output back into the conversation on approval", async () => {
    // A synthetic approval-gated template stands in for the real CLI binaries so the test is
    // deterministic and doesn't depend on claude/codex/antigravity being installed.
    const echoTemplate: CommandTemplate = {
      id: "claude-dispatch",
      executable: process.execPath,
      displayExecutable: "node",
      fixedArguments: [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write('ECHO:'+d));"
      ],
      argumentMode: "prompt_stdin",
      minimumArguments: 0,
      maximumArguments: 0,
      defaultWorkingDirectory: ".",
      allowedWorkingDirectories: ["."],
      environmentVariableNames: [],
      inheritedEnvironmentVariableNames: [],
      policyClass: "approval_required",
      targetAlias: "claude-code-cli",
      policyReason: "test",
      policyVersion: "local-policy-v1",
      approvalTtlMilliseconds: 5 * 60 * 1000,
      timeoutMilliseconds: 5_000,
      maxOutputBytes: 4096
    };
    const { studio, approvals, project } = createStudioFixture([
      ...defaultCommandTemplates().filter((t) => t.id !== "claude-dispatch"),
      echoTemplate
    ]);
    const session = studio.createSession({
      projectId: project.id,
      title: "Round trip",
      activeAgent: "claude"
    });

    const seen: string[] = [];
    studio.onMessage((_sessionId, message) => seen.push(message.content));

    const { assistantMessage } = await studio.dispatchPrompt(session.id, {
      targetAgent: "claude",
      prompt: "exact prompt text"
    });
    const approvalId = assistantMessage.approvalId!;
    const pending = approvals.listPending(project.id)[0]!;

    const decision = await approvals.decide(approvalId, {
      decision: "approve",
      expectedDigest: pending.actionDigest
    });
    expect(decision.status).toBe("succeeded");

    // The follow-up message (delivered via onMessage, mirroring the WebSocket broadcast) carries
    // the real stdout — proof the prompt reached the child process over stdin, not argv.
    expect(seen.some((content) => content.includes("ECHO:exact prompt text"))).toBe(true);

    const detail = studio.getSession(session.id);
    expect(detail?.messages.length).toBe(3);
    expect(detail?.messages[2]?.content).toContain("ECHO:exact prompt text");
  });

  it("does not execute a rejected dispatch and records the rejection in the conversation", async () => {
    const { studio, approvals, project } = createStudioFixture();
    const session = studio.createSession({
      projectId: project.id,
      title: "Reject check",
      activeAgent: "codex"
    });

    const seen: string[] = [];
    studio.onMessage((_sessionId, message) => seen.push(message.content));

    const { assistantMessage } = await studio.dispatchPrompt(session.id, {
      targetAgent: "codex",
      prompt: "do not run this"
    });
    const pending = approvals.listPending(project.id)[0]!;

    const decision = await approvals.decide(assistantMessage.approvalId!, {
      decision: "reject",
      expectedDigest: pending.actionDigest
    });
    expect(decision.status).toBe("rejected");
    expect(seen.some((content) => content.includes("Rejected"))).toBe(true);
  });

  it("handles WebSocket frame fragmentation for large payloads safely", () => {
    // 1. Small payload
    const smallPayload = JSON.stringify({ message: "hello" });
    const smallFrames = frameFragmentedText(smallPayload);
    expect(smallFrames.length).toBe(1);
    expect(smallFrames[0]?.[0]).toBe(0x81); // FIN + text opcode

    // 2. Large payload (> 64KB)
    const largeData = "A".repeat(80 * 1024);
    const largePayload = JSON.stringify({ data: largeData });
    const largeFrames = frameFragmentedText(largePayload);

    expect(largeFrames.length).toBeGreaterThan(1);
    // First frame has FIN = 0, opcode = 0x01 (text)
    expect(largeFrames[0]?.[0]).toBe(0x01);
    // Final frame has FIN = 1, opcode = 0x00 (continuation)
    const finalFrame = largeFrames[largeFrames.length - 1];
    expect(finalFrame?.[0]).toBe(0x80);
  });

  it("enforces argv safety in prompt_stdin mode and rejects shell-metacharacters/traversal", () => {
    const { projectRoot } = createStudioFixture();
    const template: CommandTemplate = {
      id: "test-stdin-tokens",
      executable: process.execPath,
      displayExecutable: "node",
      fixedArguments: [],
      argumentMode: "prompt_stdin",
      minimumArguments: 0,
      maximumArguments: 2,
      defaultWorkingDirectory: ".",
      allowedWorkingDirectories: ["."],
      environmentVariableNames: [],
      inheritedEnvironmentVariableNames: [],
      policyClass: "auto_allow",
      timeoutMilliseconds: 5000,
      maxOutputBytes: 4096
    };
    const registry = new CommandRegistry([template]);

    // Valid arguments
    expect(() => registry.validatePlan(template, projectRoot, ["--safe-flag", "valid_token"])).not.toThrow();

    // Rejection on invalid argv tokens with spaces or shell metacharacters
    expect(() => registry.validatePlan(template, projectRoot, ["--flag; rm -rf /"])).toThrow(
      "A command argument violates the registered token policy."
    );
    expect(() => registry.validatePlan(template, projectRoot, ["../escape"])).toThrow(
      "A command argument violates the registered token policy."
    );
  });

  it("fails closed when dispatching a prompt command bound to a locked vault profile", async () => {
    const lockedTemplate: CommandTemplate = {
      id: "agent-dispatch",
      executable: process.execPath,
      displayExecutable: "node",
      fixedArguments: ["-e", "process.stdout.write('secret')"],
      argumentMode: "prompt_stdin",
      minimumArguments: 0,
      maximumArguments: 0,
      defaultWorkingDirectory: ".",
      allowedWorkingDirectories: ["."],
      environmentProfile: "production-secrets",
      environmentVariableNames: ["API_KEY"],
      inheritedEnvironmentVariableNames: [],
      policyClass: "auto_allow",
      timeoutMilliseconds: 5000,
      maxOutputBytes: 4096
    };

    const { project, studio } = createStudioFixture([lockedTemplate]);
    const session = studio.createSession({
      projectId: project.id,
      title: "Vault Lock Test",
      activeAgent: "team"
    });

    // The vault is never unlocked in this fixture, so the command must be rejected before spawn —
    // the child process (which would print the literal word "secret") must never run.
    const { assistantMessage } = await studio.dispatchPrompt(session.id, {
      targetAgent: "team",
      prompt: "test vault locked dispatch"
    });

    expect(assistantMessage.content).toMatch(/Failed/);
    expect(assistantMessage.content).not.toContain("secret");
  });
});


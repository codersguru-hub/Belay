import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentMeshApp, type AgentMeshApp } from "../packages/daemon/src/app.js";
import type { CommandTemplate } from "../packages/daemon/src/executor/command-registry.js";

const cleanupDirectories: string[] = [];
const cleanupApps: AgentMeshApp[] = [];

function approvalTemplate(scriptPath: string, markerPath: string): CommandTemplate {
  return {
    id: "staging-reload",
    executable: process.execPath,
    displayExecutable: "node",
    fixedArguments: [scriptPath, markerPath],
    argumentMode: "safe_tokens",
    minimumArguments: 0,
    maximumArguments: 1,
    defaultWorkingDirectory: ".",
    allowedWorkingDirectories: ["."],
    environmentVariableNames: [],
    inheritedEnvironmentVariableNames: [],
    policyClass: "approval_required",
    targetAlias: "staging-api",
    policyReason: "Reloading staging changes a protected runtime.",
    policyVersion: "demo-policy-v1",
    approvalTtlMilliseconds: 60_000,
    timeoutMilliseconds: 2_000,
    maxOutputBytes: 4_096
  };
}

function fixture(now = new Date("2026-08-15T10:00:00.000Z")) {
  const root = mkdtempSync(join(tmpdir(), "agentmesh-approval-"));
  cleanupDirectories.push(root);
  const stateDirectory = join(root, ".state");
  const scriptPath = join(root, "reload.mjs");
  const markerPath = join(root, "reload.marker");
  writeFileSync(
    scriptPath,
    `import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], "executed\\n");\n`,
    "utf8"
  );
  let clock = now;
  const template = approvalTemplate(scriptPath, markerPath);
  const app = createAgentMeshApp({
    projectRoot: root,
    stateDirectory,
    port: 0,
    commandTemplates: [template],
    now: () => clock
  });
  cleanupApps.push(app);
  return {
    app,
    root,
    stateDirectory,
    markerPath,
    template,
    advance(milliseconds: number) {
      clock = new Date(clock.getTime() + milliseconds);
    }
  };
}

afterEach(async () => {
  for (const app of cleanupApps.splice(0)) await app.close();
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("approval policy and immutable action digest", () => {
  it("holds execution while pending, rejects without invoking, then approves a distinct request once", async () => {
    const f = fixture();
    const first = await f.app.approvals.request({
      projectRoot: f.root,
      commandId: "staging-reload",
      arguments: ["api"],
      requester: "claude-code"
    });
    expect(first).toMatchObject({
      status: "pending",
      requester: "claude-code",
      targetAlias: "staging-api",
      environmentVariableNames: []
    });
    expect(existsSync(f.markerPath)).toBe(false);
    if (first.status !== "pending") throw new Error("Expected pending approval");
    const rejected = await f.app.approvals.decide(first.approvalId, {
      decision: "reject",
      expectedDigest: first.actionDigest,
      reason: "Demo rejection"
    });
    expect(rejected.status).toBe("rejected");
    expect(existsSync(f.markerPath)).toBe(false);

    f.advance(1);
    const second = await f.app.approvals.request({
      projectRoot: f.root,
      commandId: "staging-reload",
      arguments: ["api"],
      requester: "claude-code"
    });
    if (second.status !== "pending") throw new Error("Expected pending approval");
    expect(second.approvalId).not.toBe(first.approvalId);
    expect(second.actionDigest).not.toBe(first.actionDigest);
    const approved = await f.app.approvals.decide(second.approvalId, {
      decision: "approve",
      expectedDigest: second.actionDigest
    });
    expect(approved.status).toBe("succeeded");
    expect(existsSync(f.markerPath)).toBe(true);
    expect(await import("node:fs").then(({ readFileSync }) => readFileSync(f.markerPath, "utf8")))
      .toBe("executed\n");
    await expect(
      f.app.approvals.decide(second.approvalId, {
        decision: "approve",
        expectedDigest: second.actionDigest
      })
    ).rejects.toMatchObject({ code: "APPROVAL_CONFLICT" });
    expect(await import("node:fs").then(({ readFileSync }) => readFileSync(f.markerPath, "utf8")))
      .toBe("executed\n");
  });

  it("invalidates a mutated action digest before executor invocation", async () => {
    const f = fixture();
    const pending = await f.app.approvals.request({
      projectRoot: f.root,
      commandId: "staging-reload",
      arguments: ["api"],
      requester: "codex"
    });
    if (pending.status !== "pending") throw new Error("Expected pending approval");
    f.app.database.prepare(
      "UPDATE approval_requests SET arguments_json = '[\"worker\"]' WHERE id = ?"
    ).run(pending.approvalId);
    await expect(
      f.app.approvals.decide(pending.approvalId, {
        decision: "approve",
        expectedDigest: pending.actionDigest
      })
    ).rejects.toMatchObject({ code: "APPROVAL_CONFLICT" });
    expect(existsSync(f.markerPath)).toBe(false);
  });

  it("expires pending requests and recovers ambiguous execution as indeterminate", async () => {
    const f = fixture();
    const pending = await f.app.approvals.request({
      projectRoot: f.root,
      commandId: "staging-reload",
      arguments: [],
      requester: "codex"
    });
    if (pending.status !== "pending") throw new Error("Expected pending approval");
    f.advance(60_001);
    await expect(
      f.app.approvals.decide(pending.approvalId, {
        decision: "approve",
        expectedDigest: pending.actionDigest
      })
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect(existsSync(f.markerPath)).toBe(false);

    f.app.database.prepare(
      "UPDATE approval_requests SET status = 'executing' WHERE id = ?"
    ).run(pending.approvalId);
    await f.app.close();
    const restarted = createAgentMeshApp({
      projectRoot: f.root,
      stateDirectory: f.stateDirectory,
      commandTemplates: [f.template]
    });
    cleanupApps.push(restarted);
    const row = restarted.database.prepare(
      "SELECT status, outcome_json FROM approval_requests WHERE id = ?"
    ).get(pending.approvalId);
    expect(row).toEqual({ status: "indeterminate", outcome_json: '{"reason":"daemon_restart"}' });
    expect(existsSync(f.markerPath)).toBe(false);
  });

  it("requires the local token for REST decisions and emits sanitized WebSocket events", async () => {
    const f = fixture();
    const endpoint = await f.app.start();
    const pending = await f.app.approvals.request({
      projectRoot: f.root,
      commandId: "staging-reload",
      arguments: [],
      requester: "antigravity"
    });
    if (pending.status !== "pending") throw new Error("Expected pending approval");
    const project = f.app.database.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
    const listed = await fetch(
      `http://${endpoint.host}:${endpoint.port}/api/projects/${project.id}/approvals?status=pending`
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ approvals: [expect.objectContaining({ approvalId: pending.approvalId })] });

    const unauthorized = await fetch(
      `http://${endpoint.host}:${endpoint.port}/api/approvals/${pending.approvalId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "reject", expectedDigest: pending.actionDigest })
      }
    );
    expect(unauthorized.status).toBe(401);

    const protocol = `agentmesh-token.${f.app.dashboardSessionToken}`;
    const socket = new WebSocket(`ws://${endpoint.host}:${endpoint.port}/events`, protocol);
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener("open", () => resolvePromise(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
    });
    const eventPromise = new Promise<Record<string, unknown>>((resolvePromise) => {
      socket.addEventListener("message", (event) => {
        resolvePromise(JSON.parse(String(event.data)) as Record<string, unknown>);
      }, { once: true });
    });
    const response = await fetch(
      `http://${endpoint.host}:${endpoint.port}/api/approvals/${pending.approvalId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${f.app.dashboardSessionToken}`
        },
        body: JSON.stringify({
          decision: "reject",
          expectedDigest: pending.actionDigest,
          reason: "Not during demo setup"
        })
      }
    );
    expect(response.status).toBe(200);
    const event = await eventPromise;
    expect(event).toEqual(expect.objectContaining({
      type: "approval.updated",
      approvalId: pending.approvalId,
      status: "rejected",
      targetAlias: "staging-api",
      commandId: "staging-reload"
    }));
    expect(JSON.stringify(event)).not.toContain(f.app.dashboardSessionToken);
    socket.close();
  });
});

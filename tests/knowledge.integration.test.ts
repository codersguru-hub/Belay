import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentMeshApp, type AgentMeshApp } from "../packages/daemon/src/app.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";

const cleanupDirectories: string[] = [];
const cleanupApps: AgentMeshApp[] = [];

function fixture(workspaceName?: string) {
  const root = mkdtempSync(join(tmpdir(), "agentmesh-knowledge-"));
  cleanupDirectories.push(root);
  const app = createAgentMeshApp({
    projectRoot: root,
    stateDirectory: join(root, ".state"),
    workspaceName: workspaceName ?? null,
    now: () => new Date("2026-08-16T10:00:00.000Z")
  });
  cleanupApps.push(app);
  return { app, root };
}

afterEach(async () => {
  for (const app of cleanupApps.splice(0)) await app.close();
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("approved shared semantic knowledge", () => {
  it("keeps proposals out of context and detects payload mutation before approval", async () => {
    const { app, root } = fixture();
    const pending = app.approvals.proposeKnowledge({
      projectRoot: root,
      knowledgeId: "fact-contract-boundary",
      requester: "claude-code",
      scope: "project",
      kind: "constraint",
      title: "Shared contract boundary",
      body: "All clients consume schemas from @agentmesh/contracts.",
      priority: 90
    });
    expect(pending).toMatchObject({
      status: "pending",
      actionKind: "knowledge",
      knowledge: { knowledgeId: "fact-contract-boundary", scope: "project" }
    });
    expect(app.coordination.getStageContext({ projectRoot: root, historyLimit: 10 }).knowledge.items)
      .toEqual([]);

    app.database.prepare(
      `UPDATE approval_requests
       SET action_payload_json = json_set(action_payload_json, '$.body', 'mutated')
       WHERE id = ?`
    ).run(pending.approvalId);
    await expect(app.approvals.decide(pending.approvalId, {
      decision: "approve",
      expectedDigest: pending.actionDigest
    })).rejects.toMatchObject({ code: "APPROVAL_CONFLICT" });
    expect(app.coordination.listKnowledge({
      projectRoot: root,
      includeSuperseded: false,
      limit: 100
    }).items).toEqual([]);
  });

  it("atomically publishes an approved fact and preserves its supersession chain", async () => {
    const { app, root } = fixture();
    const first = app.approvals.proposeKnowledge({
      projectRoot: root,
      knowledgeId: "fact-workflow-v1",
      requester: "codex",
      scope: "project",
      kind: "convention",
      title: "Workflow source of truth",
      body: "Read the shared checklist before acquiring a task.",
      priority: 80
    });
    const approved = await app.approvals.decide(first.approvalId, {
      decision: "approve",
      expectedDigest: first.actionDigest
    });
    expect(approved).toMatchObject({
      status: "succeeded",
      commandRunId: null,
      outcome: { knowledgeId: "fact-workflow-v1", scope: "project" }
    });
    expect(app.coordination.getStageContext({ projectRoot: root, historyLimit: 10 }).knowledge.items)
      .toEqual([expect.objectContaining({ id: "fact-workflow-v1", approvalId: first.approvalId })]);

    expect(() => app.approvals.proposeKnowledge({
      projectRoot: root,
      knowledgeId: "fact-workflow-collision",
      requester: "antigravity",
      scope: "project",
      kind: "convention",
      title: "Workflow source of truth",
      body: "A conflicting definition.",
      priority: 80
    })).toThrow(expect.objectContaining({ code: "KNOWLEDGE_CONFLICT" }));

    const replacement = app.approvals.proposeKnowledge({
      projectRoot: root,
      knowledgeId: "fact-workflow-v2",
      requester: "antigravity",
      scope: "project",
      kind: "convention",
      title: "Workflow source of truth",
      body: "Read approved knowledge and the shared checklist before acquiring a task.",
      priority: 90,
      supersedesId: "fact-workflow-v1"
    });
    await app.approvals.decide(replacement.approvalId, {
      decision: "approve",
      expectedDigest: replacement.actionDigest
    });

    const active = app.coordination.listKnowledge({
      projectRoot: root,
      includeSuperseded: false,
      limit: 100
    });
    expect(active.items.map((item) => item.knowledgeId)).toEqual(["fact-workflow-v2"]);
    const history = app.coordination.listKnowledge({
      projectRoot: root,
      includeSuperseded: true,
      limit: 100
    });
    expect(history.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ knowledgeId: "fact-workflow-v1", supersededBy: "fact-workflow-v2" }),
      expect.objectContaining({ knowledgeId: "fact-workflow-v2", supersedesId: "fact-workflow-v1" })
    ]));
  });

  it("shares workspace facts across grouped repositories while isolating project facts", async () => {
    const { app, root } = fixture("agentmesh-suite");
    const siblingRoot = join(root, "sibling-repo");
    mkdirSync(siblingRoot);
    bootstrapProject(
      app.database,
      siblingRoot,
      "2026-08-16T10:00:00.000Z",
      "agentmesh-suite"
    );

    for (const proposal of [
      app.approvals.proposeKnowledge({
        projectRoot: root,
        knowledgeId: "fact-project-only",
        requester: "codex",
        scope: "project",
        kind: "topology",
        title: "Daemon entrypoint",
        body: "This repository owns the daemon entrypoint.",
        priority: 70
      }),
      app.approvals.proposeKnowledge({
        projectRoot: root,
        knowledgeId: "fact-workspace-wide",
        requester: "codex",
        scope: "workspace",
        kind: "glossary",
        title: "Mesh",
        body: "The coordinated set of agents and repositories.",
        priority: 60
      })
    ]) {
      await app.approvals.decide(proposal.approvalId, {
        decision: "approve",
        expectedDigest: proposal.actionDigest
      });
    }

    const sibling = app.coordination.getStageContext({ projectRoot: siblingRoot, historyLimit: 10 });
    expect(sibling.knowledge.items.map((item) => item.id)).toEqual(["fact-workspace-wide"]);
  });
});

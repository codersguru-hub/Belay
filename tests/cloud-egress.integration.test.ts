import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CloudSummaryRequestV1,
  CloudSummaryResponse
} from "@belay/contracts";
import { openStateDatabase } from "../packages/daemon/src/db/connection.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";
import { ManifestService } from "../packages/daemon/src/indexer/manifest-service.js";
import { CloudIntelligenceService } from "../packages/daemon/src/cloud/cloud-intelligence-service.js";
import { CoordinationService } from "../packages/daemon/src/coordination/coordination-service.js";
import type { CloudSummaryAdapter } from "../packages/daemon/src/cloud/cloud-run-adapter.js";
import {
  EgressGuard,
  EgressRejectedError
} from "../packages/daemon/src/cloud/egress-guard.js";
import type { VaultService } from "../packages/daemon/src/vault/vault-service.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function allowedPayload(): CloudSummaryRequestV1 {
  return {
    version: 1,
    kind: "manifest_summary",
    projectAlias: "demo-project",
    manifest: {
      frameworks: ["typescript", "vite"],
      scripts: ["build", "test"],
      ports: [{ port: 3420, evidenceType: "config" }],
      topology: [{ pathHashOrRelativePath: "src/index.ts", symbolKinds: ["function"] }],
      git: { branch: "main", dirtyFileCount: 2 }
    }
  };
}

describe("cloud egress privacy boundary", () => {
  it("allows only the exact bounded structural schema", () => {
    const inspected = new EgressGuard().inspect(allowedPayload());
    expect(inspected.payload.kind).toBe("manifest_summary");
    expect(inspected.payloadHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(inspected.fieldCounts).toEqual({
      frameworks: 2,
      scripts: 2,
      ports: 1,
      topology: 1,
      audit: 0,
      conflictHeldPaths: 0,
      fleetCandidatePaths: 0,
      fleetAgents: 0
    });
  });

  it.each([
    ["raw source field", { ...allowedPayload(), source: "export const secret = 1" }],
    ["unknown key", { ...allowedPayload(), harmlessExtra: "no" }],
    ["private key marker", { ...allowedPayload(), projectAlias: "-----BEGIN PRIVATE KEY-----" }],
    ["connection string", {
      ...allowedPayload(),
      manifest: { ...allowedPayload().manifest!, frameworks: ["postgres://user:pass@db/private"] }
    }],
    ["oversized payload", {
      ...allowedPayload(),
      manifest: { ...allowedPayload().manifest!, frameworks: ["x".repeat(40_000)] }
    }]
  ])("blocks %s before a network adapter can run", (_label, candidate) => {
    let networkCalls = 0;
    const guardedSend = (value: unknown) => {
      const allowed = new EgressGuard().inspect(value);
      networkCalls += 1;
      return allowed;
    };
    expect(() => guardedSend(candidate)).toThrow(EgressRejectedError);
    expect(networkCalls).toBe(0);
  });

  it("allows a metadata-only lock conflict payload and counts its contended paths", () => {
    const inspected = new EgressGuard().inspect({
      version: 1,
      kind: "lock_conflict_advice",
      projectAlias: "demo-project",
      conflict: {
        requesterAlias: "claude-code",
        heldPaths: [
          { path: "src/auth-service.ts", holderAlias: "codex", symbolKinds: ["class", "function"] },
          { path: "src/session.ts", holderAlias: "codex", symbolKinds: ["interface"] }
        ],
        availablePaths: ["src/routes/login.ts"]
      }
    });
    expect(inspected.payload.kind).toBe("lock_conflict_advice");
    expect(inspected.fieldCounts.conflictHeldPaths).toBe(2);
  });

  it.each([
    ["a raw file body smuggled into a conflict", {
      version: 1,
      kind: "lock_conflict_advice",
      projectAlias: "demo-project",
      conflict: {
        requesterAlias: "claude-code",
        heldPaths: [{ path: "src/a.ts", holderAlias: "codex", symbolKinds: [], source: "export const x = 1" }],
        availablePaths: []
      }
    }],
    ["a conflict carrying a manifest at the same time", {
      version: 1,
      kind: "lock_conflict_advice",
      projectAlias: "demo-project",
      manifest: allowedPayload().manifest,
      conflict: {
        requesterAlias: "claude-code",
        heldPaths: [{ path: "src/a.ts", holderAlias: "codex", symbolKinds: [] }],
        availablePaths: []
      }
    }],
    ["a conflict declaring the wrong kind", {
      version: 1,
      kind: "manifest_summary",
      projectAlias: "demo-project",
      conflict: {
        requesterAlias: "claude-code",
        heldPaths: [{ path: "src/a.ts", holderAlias: "codex", symbolKinds: [] }],
        availablePaths: []
      }
    }]
  ])("rejects %s", (_label, candidate) => {
    expect(() => new EgressGuard().inspect(candidate)).toThrow(EgressRejectedError);
  });

  it("blocks known secret values and approved encodings before network", () => {
    const canary = "BELAY-CLOUD-CANARY-8d7e9f";
    const variants = [
      canary,
      Buffer.from(canary).toString("base64"),
      Buffer.from(canary).toString("hex"),
      encodeURIComponent(canary)
    ];
    for (const variant of variants) {
      const candidate = allowedPayload();
      candidate.manifest!.frameworks = [variant];
      expect(() => new EgressGuard([canary]).inspect(candidate)).toThrow(EgressRejectedError);
    }
  });

  it("sends only aliases, paths, and symbol kinds when adjudicating a lock conflict", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "belay-conflict-"));
    temporaryDirectories.push(stateDirectory);
    const projectRoot = resolve("tests/fixtures/demo-repo");
    const { database } = openStateDatabase(join(stateDirectory, "state.db"));
    bootstrapProject(database, projectRoot);
    const manifests = new ManifestService(database);
    manifests.indexProject(projectRoot);
    const vault = {
      status: () => ({ state: "unconfigured", variableNames: [] })
    } as unknown as VaultService;

    let sent: CloudSummaryRequestV1 | undefined;
    const adapter: CloudSummaryAdapter = {
      provider: "mock-cloud-run",
      async summarize(payload, options): Promise<CloudSummaryResponse> {
        sent = payload;
        return {
          requestId: options.requestId,
          model: "gemini-3.6-flash",
          summary: "codex holds src/auth-service.ts; proceed on src/routes/login.ts first.",
          riskLevel: "low",
          generatedAt: "2026-08-15T12:00:00.000Z"
        };
      }
    };
    const service = new CloudIntelligenceService(
      database,
      manifests,
      vault,
      projectRoot,
      adapter,
      { createRequestId: () => "123e4567-e89b-42d3-a456-426614174001" }
    );

    const result = await service.explainLockConflict({
      requesterAlias: "claude-code",
      heldPaths: [{ path: "src/auth-service.ts", holderAlias: "codex", symbolKinds: ["class"] }],
      availablePaths: ["src/routes/login.ts"]
    });

    expect(result.model).toBe("gemini-3.6-flash");
    expect(result.summary).toContain("src/routes/login.ts");
    expect(sent?.kind).toBe("lock_conflict_advice");
    expect(sent?.manifest).toBeUndefined();
    // Nothing beyond the declared conflict projection may cross the boundary.
    expect(Object.keys(sent ?? {}).sort()).toEqual(["conflict", "kind", "projectAlias", "version"]);
    database.close();
  });

  it("lets Gemini decompose a high-level goal using only bounded manifest topology", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "belay-fleet-plan-"));
    temporaryDirectories.push(stateDirectory);
    const projectRoot = resolve("tests/fixtures/demo-repo");
    const { database } = openStateDatabase(join(stateDirectory, "state.db"));
    bootstrapProject(database, projectRoot);
    const manifests = new ManifestService(database);
    manifests.indexProject(projectRoot);
    const vault = {
      status: () => ({ state: "unconfigured", variableNames: [] })
    } as unknown as VaultService;

    let sent: CloudSummaryRequestV1 | import("@belay/contracts").FleetTaskDecompositionRequestV1 | undefined;
    const requestId = "323e4567-e89b-42d3-a456-426614174000";
    const adapter: CloudSummaryAdapter = {
      provider: "mock-cloud-run",
      async summarize() { throw new Error("not used"); },
      async decomposeFleetTask(payload, options) {
        sent = payload;
        const candidatePaths = payload.manifest.candidatePaths.map((entry) => entry.path);
        return {
          requestId: options.requestId,
          planId: "423e4567-e89b-42d3-a456-426614174000",
          model: "gemini-3.6-flash",
          goalSummary: "Split the auth hardening across implementation, review, and integration.",
          tasks: [
            {
              taskId: "implement-auth-hardening",
              title: "Implement auth hardening",
              assignedAgent: "codex",
              leasePaths: [candidatePaths[0]!],
              dependsOn: [],
              acceptanceCriteria: ["Auth changes pass focused tests"],
              riskLevel: "medium"
            }
          ],
          generatedAt: "2026-08-20T12:00:00.000Z"
        };
      }
    };
    const service = new CloudIntelligenceService(
      database,
      manifests,
      vault,
      projectRoot,
      adapter,
      { createRequestId: () => requestId }
    );

    const plan = await service.decomposeFleetTask(
      "Refactor auth to RS256 and add rate limiting before agents execute."
    );
    expect(plan.tasks[0]?.assignedAgent).toBe("codex");
    expect(sent?.kind).toBe("fleet_task_decomposition");
    expect(sent && "goal" in sent ? sent.goal : "").toContain("RS256");
    expect(Object.keys(sent ?? {}).sort()).toEqual([
      "agents",
      "goal",
      "kind",
      "manifest",
      "projectAlias",
      "version"
    ]);
    expect(JSON.stringify(sent)).not.toContain("export const");
    const row = database
      .prepare("SELECT kind, payload_hash, field_counts_json FROM cloud_summary_requests WHERE id = ?")
      .get(requestId) as Record<string, string>;
    expect(row.kind).toBe("fleet_task_decomposition");
    expect(row.payload_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(row.field_counts_json)).toMatchObject({ fleetAgents: 3 });
    expect(service.fleetTaskPlan(plan.planId)).toEqual(plan);
    const staged = new CoordinationService(database).stageFleetTaskPlan({
      projectRoot,
      plan,
      leaseSeconds: 900
    });
    expect(staged.tasks).toHaveLength(1);
    expect(staged.tasks[0]).toMatchObject({
      agentName: "codex",
      lockedFiles: plan.tasks[0]?.leasePaths
    });

    const fleetRequest = sent?.kind === "fleet_task_decomposition" ? sent : undefined;
    const firstFreePath = fleetRequest?.manifest.candidatePaths.find(
      (entry) => !plan.tasks[0]?.leasePaths.includes(entry.path)
    )?.path;
    expect(firstFreePath).toBeTruthy();
    const conflictingPlan: import("@belay/contracts").FleetTaskPlanResponse = {
      requestId: "523e4567-e89b-42d3-a456-426614174000",
      planId: "623e4567-e89b-42d3-a456-426614174000",
      model: "gemini-3.6-flash",
      goalSummary: "Atomic conflict fixture",
      tasks: [
        {
          taskId: "free-first",
          title: "Acquire the initially free path",
          assignedAgent: "claude-code",
          leasePaths: [firstFreePath!],
          dependsOn: [],
          acceptanceCriteria: ["Lease is held only if the full plan succeeds"],
          riskLevel: "low"
        },
        {
          taskId: "conflict-second",
          title: "Collide with the prior fleet plan",
          assignedAgent: "antigravity",
          leasePaths: [plan.tasks[0]!.leasePaths[0]!],
          dependsOn: [],
          acceptanceCriteria: ["Conflict rolls back every task in this plan"],
          riskLevel: "medium"
        }
      ],
      generatedAt: "2026-08-20T12:05:00.000Z"
    };
    expect(() => new CoordinationService(database).stageFleetTaskPlan({
      projectRoot,
      plan: conflictingPlan,
      leaseSeconds: 900
    })).toThrow();
    const rolledBack = database
      .prepare("SELECT count(*) AS count FROM tasks WHERE id LIKE ?")
      .get(`gemini:${conflictingPlan.planId}:%`) as { count: number };
    expect(rolledBack.count).toBe(0);
    database.close();
  });

  it("records metadata-only success and leaves local state usable on cloud failure", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "belay-cloud-"));
    temporaryDirectories.push(stateDirectory);
    const projectRoot = resolve("tests/fixtures/demo-repo");
    const { database } = openStateDatabase(join(stateDirectory, "state.db"));
    bootstrapProject(database, projectRoot);
    const manifests = new ManifestService(database);
    manifests.indexProject(projectRoot);
    const vault = {
      status: () => ({ state: "unconfigured", variableNames: [] })
    } as unknown as VaultService;
    let calls = 0;
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const adapter: CloudSummaryAdapter = {
      provider: "mock-cloud-run",
      async summarize(_payload, options): Promise<CloudSummaryResponse> {
        calls += 1;
        return {
          requestId: options.requestId,
          model: "gemini-3.6-flash",
          summary: "Labeled structural summary.",
          riskLevel: "low",
          generatedAt: "2026-08-15T12:00:00.000Z"
        };
      }
    };
    const service = new CloudIntelligenceService(
      database,
      manifests,
      vault,
      projectRoot,
      adapter,
      { createRequestId: () => requestId }
    );
    const result = await service.summarizeManifest();
    expect(result.model).toBe("gemini-3.6-flash");
    expect(calls).toBe(1);
    expect(service.status().state).toBe("online");
    const row = database.prepare("SELECT * FROM cloud_summary_requests WHERE id = ?").get(requestId) as Record<string, unknown>;
    expect(row.status).toBe("succeeded");
    expect(row.payload_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(row)).not.toContain("payload");
    expect(JSON.stringify(row)).not.toContain("src/index.ts");

    const failing: CloudSummaryAdapter = {
      provider: "mock-cloud-run",
      async summarize() { throw new Error("offline details that must not escape"); }
    };
    const degraded = new CloudIntelligenceService(
      database,
      manifests,
      vault,
      projectRoot,
      failing,
      { createRequestId: () => "223e4567-e89b-42d3-a456-426614174000" }
    );
    await expect(degraded.summarizeManifest()).rejects.toMatchObject({ code: "CLOUD_UNAVAILABLE" });
    expect(degraded.status()).toMatchObject({ state: "degraded" });
    expect(manifests.getLatest(projectRoot)?.projectId).toBeTruthy();
    database.close();
  });
});

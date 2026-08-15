import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CloudSummaryRequestV1,
  CloudSummaryResponse
} from "@agentmesh/contracts";
import { openStateDatabase } from "../packages/daemon/src/db/connection.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";
import { ManifestService } from "../packages/daemon/src/indexer/manifest-service.js";
import { CloudIntelligenceService } from "../packages/daemon/src/cloud/cloud-intelligence-service.js";
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
      audit: 0
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

  it("blocks known secret values and approved encodings before network", () => {
    const canary = "AGENTMESH-CLOUD-CANARY-8d7e9f";
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

  it("records metadata-only success and leaves local state usable on cloud failure", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-cloud-"));
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

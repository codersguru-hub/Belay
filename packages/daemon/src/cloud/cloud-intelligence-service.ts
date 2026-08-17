import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CloudLockConflict,
  CloudSummaryRequestV1,
  CloudSummaryResponse,
  ProjectManifestV1
} from "@agentmesh/contracts";
import type { ManifestService } from "../indexer/manifest-service.js";
import type { VaultService } from "../vault/vault-service.js";
import {
  completeCloudRequest,
  insertCloudRequest
} from "../db/repositories/cloud-request-repository.js";
import { EgressGuard, type AllowedEgress } from "./egress-guard.js";
import type { CloudSummaryAdapter } from "./cloud-run-adapter.js";

const DEFAULT_TIMEOUT_MILLISECONDS = 8_000;

function safeAlias(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 80) || fallback;
}

function manifestPayload(projectAlias: string, manifest: ProjectManifestV1): CloudSummaryRequestV1 {
  return {
    version: 1,
    kind: "manifest_summary",
    projectAlias,
    manifest: {
      frameworks: manifest.frameworks,
      scripts: manifest.scripts,
      ports: manifest.ports.map((entry) => ({
        port: entry.port,
        evidenceType: entry.evidence
      })),
      topology: manifest.topology.map((entry) => ({
        pathHashOrRelativePath: entry.path,
        symbolKinds: [...new Set(entry.exports.map((item) => item.kind))].sort()
      })),
      git: {
        branch: manifest.git.branch ?? "detached",
        dirtyFileCount: manifest.git.dirtyFileCount
      }
    }
  };
}

export class CloudIntelligenceUnavailableError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "NO_MANIFEST" | "CLOUD_UNAVAILABLE") {
    super(`Cloud intelligence unavailable: ${code}`);
    this.name = "CloudIntelligenceUnavailableError";
  }
}

export class CloudIntelligenceService {
  private lastResult: { model: string; generatedAt: string } | undefined;
  private lastFailureAt: string | undefined;

  constructor(
    private readonly database: Database.Database,
    private readonly manifests: ManifestService,
    private readonly vault: VaultService,
    private readonly projectRoot: string,
    private readonly adapter?: CloudSummaryAdapter,
    private readonly options: {
      now?: () => Date;
      createRequestId?: () => string;
      timeoutMilliseconds?: number;
    } = {}
  ) {}

  status(): {
    state: "online" | "degraded" | "local_only";
    message: string;
    model?: string;
    generatedAt?: string;
  } {
    if (this.lastResult) {
      return {
        state: "online",
        message: `Gemini advisory ready · ${this.lastResult.model}`,
        model: this.lastResult.model,
        generatedAt: this.lastResult.generatedAt
      };
    }
    // An unconfigured optional cloud plane is a deliberate local-only posture, not a fault.
    // Only a configured-but-failing adapter is genuinely degraded.
    if (!this.adapter) {
      return {
        state: "local_only",
        message: "Local-only mode · All coordination and approvals active"
      };
    }
    return {
      state: this.lastFailureAt ? "degraded" : "online",
      message: this.lastFailureAt
        ? "Gemini advisory unavailable · Local controls unaffected"
        : "Gemini advisory connected · Awaiting first request"
    };
  }

  projectId(): string | undefined {
    return this.manifests.getLatest(this.projectRoot)?.projectId;
  }

  async summarizeManifest(): Promise<CloudSummaryResponse> {
    if (!this.adapter) throw new CloudIntelligenceUnavailableError("NOT_CONFIGURED");
    const snapshot = this.manifests.getLatest(this.projectRoot);
    if (!snapshot) throw new CloudIntelligenceUnavailableError("NO_MANIFEST");
    const payload = manifestPayload(
      safeAlias(snapshot.manifest.project.name, "agentmesh-project"),
      snapshot.manifest
    );
    return this.dispatch(payload, snapshot.projectId);
  }

  /**
   * Ask Gemini to explain a file-lock collision in terms of the overlapping work,
   * and suggest a non-conflicting split. Purely advisory: the caller still cannot
   * take the lock, and a rejected or unavailable cloud plane is not an error here —
   * the MCP tool falls back to the deterministic local split.
   */
  async explainLockConflict(conflict: CloudLockConflict): Promise<CloudSummaryResponse> {
    if (!this.adapter) throw new CloudIntelligenceUnavailableError("NOT_CONFIGURED");
    const snapshot = this.manifests.getLatest(this.projectRoot);
    const payload: CloudSummaryRequestV1 = {
      version: 1,
      kind: "lock_conflict_advice",
      projectAlias: safeAlias(
        snapshot?.manifest.project.name ?? "agentmesh-project",
        "agentmesh-project"
      ),
      conflict
    };
    return this.dispatch(payload, snapshot?.projectId);
  }

  private async dispatch(
    payload: CloudSummaryRequestV1,
    projectId: string | undefined
  ): Promise<CloudSummaryResponse> {
    if (!this.adapter) throw new CloudIntelligenceUnavailableError("NOT_CONFIGURED");
    const allowed = await this.inspect(payload);
    const requestId = this.options.createRequestId?.() ?? randomUUID();
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    if (projectId) {
      insertCloudRequest(this.database, { id: requestId, projectId, allowed, createdAt });
    }
    try {
      const result = await this.adapter.summarize(allowed.payload, {
        requestId,
        timeoutMilliseconds: this.options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS
      });
      if (result.requestId !== requestId) {
        throw new Error("Cloud response correlation mismatch.");
      }
      if (projectId) {
        completeCloudRequest(this.database, {
          id: requestId,
          status: "succeeded",
          completedAt: (this.options.now?.() ?? new Date()).toISOString(),
          provider: this.adapter.provider,
          model: result.model
        });
      }
      this.lastResult = { model: result.model, generatedAt: result.generatedAt };
      this.lastFailureAt = undefined;
      return result;
    } catch {
      const completedAt = (this.options.now?.() ?? new Date()).toISOString();
      if (projectId) {
        completeCloudRequest(this.database, {
          id: requestId,
          status: "failed",
          completedAt,
          provider: this.adapter.provider,
          errorCode: "CLOUD_UNAVAILABLE"
        });
      }
      this.lastFailureAt = completedAt;
      throw new CloudIntelligenceUnavailableError("CLOUD_UNAVAILABLE");
    }
  }

  private async inspect(payload: CloudSummaryRequestV1): Promise<AllowedEgress> {
    const vaultStatus = this.vault.status();
    if (vaultStatus.state !== "unlocked") return new EgressGuard().inspect(payload);
    return this.vault.withUnlockedEnvironment(vaultStatus.variableNames, (environment) =>
      new EgressGuard(Object.values(environment)).inspect(payload)
    );
  }
}

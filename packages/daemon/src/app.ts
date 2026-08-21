import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CoordinationService,
  type CoordinationServiceOptions
} from "./coordination/coordination-service.js";
import { LeaseReaper } from "./coordination/lease-reaper.js";
import { loadConfig, type BelayConfig } from "./config.js";
import { openStateDatabase } from "./db/connection.js";
import { bootstrapProject } from "./db/repositories/project-repository.js";
import { createBelayMcpServer } from "./mcp/create-server.js";
import { ManifestService } from "./indexer/manifest-service.js";
import { ManifestWatcher } from "./indexer/manifest-watcher.js";
import { CommandExecutor } from "./executor/command-executor.js";
import {
  CommandRegistry,
  defaultCommandTemplates,
  type CommandTemplate
} from "./executor/command-registry.js";
import { AgeCliAdapter, type KeyWrapAdapter } from "./vault/age-cli-adapter.js";
import { VaultService } from "./vault/vault-service.js";
import { ApprovalService } from "./approval/approval-service.js";
import { ApprovalEventHub } from "./approval/event-hub.js";
import { PolicyEngine } from "./approval/policy-engine.js";
import { recoverAmbiguousApprovals } from "./db/repositories/approval-repository.js";
import { DashboardService } from "./dashboard/dashboard-service.js";
import { CloudIntelligenceService } from "./cloud/cloud-intelligence-service.js";
import { CloudRunSummaryAdapter } from "./cloud/cloud-run-adapter.js";
import { StudioService } from "./studio/studio-service.js";
import {
  createBelayHttpServer,
  type BelayHttpServer,
  type StartedHttpServer
} from "./server/http-server.js";

export interface BelayApp {
  readonly config: BelayConfig;
  readonly database: Database.Database;
  readonly coordination: CoordinationService;
  readonly manifests: ManifestService;
  readonly vault: VaultService;
  readonly executor: CommandExecutor;
  readonly approvals: ApprovalService;
  readonly cloudIntelligence: CloudIntelligenceService;
  readonly studio: StudioService;
  readonly dashboardSessionToken: string;
  start(): Promise<StartedHttpServer>;
  close(): Promise<void>;
}

export interface CreateBelayAppOptions
  extends Partial<Pick<BelayConfig, "port" | "stateDirectory" | "projectRoot" | "cloudServiceUrl" | "workspaceName">>,
    CoordinationServiceOptions {
  leaseSweepIntervalMilliseconds?: number;
  keyWrapAdapter?: KeyWrapAdapter;
  vaultInactivityTimeoutMilliseconds?: number;
  commandTemplates?: readonly CommandTemplate[];
}

export function createBelayApp(
  options: CreateBelayAppOptions = {}
): BelayApp {
  const config = loadConfig(options);
  const { database } = openStateDatabase(config.databasePath);
  bootstrapProject(database, config.projectRoot, (options.now?.() ?? new Date()).toISOString(), config.workspaceName);
  recoverAmbiguousApprovals(database, (options.now?.() ?? new Date()).toISOString());
  const coordination = new CoordinationService(database, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.createCorrelationId
      ? { createCorrelationId: options.createCorrelationId }
      : {}),
    ...(options.maxContextBytes ? { maxContextBytes: options.maxContextBytes } : {})
  });
  const leaseReaper = new LeaseReaper(
    coordination,
    options.leaseSweepIntervalMilliseconds ?? 5_000
  );
  const manifests = new ManifestService(database, {
    ...(options.now ? { now: options.now } : {})
  });
  const vault = new VaultService(
    options.keyWrapAdapter ?? new AgeCliAdapter(config.ageBinaryPath ?? undefined),
    {
      ...(options.now ? { now: options.now } : {}),
      ...(options.vaultInactivityTimeoutMilliseconds
        ? { inactivityTimeoutMilliseconds: options.vaultInactivityTimeoutMilliseconds }
        : {})
    }
  );
  const commandRegistry = new CommandRegistry(
    options.commandTemplates ?? defaultCommandTemplates()
  );
  const executor = new CommandExecutor(
    database,
    vault,
    commandRegistry,
    {
      ...(options.now ? { now: options.now } : {})
    }
  );
  const approvalEvents = new ApprovalEventHub();
  const approvals = new ApprovalService(
    database,
    executor,
    commandRegistry,
    new PolicyEngine(),
    approvalEvents,
    { ...(options.now ? { now: options.now } : {}) }
  );
  const cloudIntelligence = new CloudIntelligenceService(
    database,
    manifests,
    vault,
    config.projectRoot,
    config.cloudServiceUrl ? new CloudRunSummaryAdapter(config.cloudServiceUrl) : undefined,
    { ...(options.now ? { now: options.now } : {}) }
  );
  const studio = new StudioService(
    database,
    config.projectRoot,
    executor,
    approvals,
    approvalEvents,
    options.now
  );
  const dashboardSessionToken = randomBytes(32).toString("base64url");
  const dashboard = new DashboardService(
    database,
    coordination,
    manifests,
    vault,
    approvals,
    cloudIntelligence,
    config.projectRoot,
    options.now
  );
  const manifestWatcher = new ManifestWatcher(config.projectRoot, manifests);
  const httpServer: BelayHttpServer = createBelayHttpServer({
    host: config.host,
    port: config.port,
    mcpServerFactory: () =>
      createBelayMcpServer(
        coordination,
        manifests,
        approvals,
        config.projectRoot,
        cloudIntelligence
      ),
    approvals,
    coordination,
    cloudIntelligence,
    approvalEvents,
    dashboardSessionToken,
    dashboard,
    studio,
    dashboardDirectory: resolve(dirname(fileURLToPath(import.meta.url)), "../../dashboard/dist")
  });
  let closed = false;
  let started = false;

  return {
    config,
    database,
    coordination,
    manifests,
    vault,
    executor,
    approvals,
    cloudIntelligence,
    studio,
    dashboardSessionToken,
    async start() {
      if (!started) {
        manifests.indexProject(config.projectRoot);
        started = true;
      }
      const endpoint = await httpServer.start();
      leaseReaper.start();
      await manifestWatcher.start();
      return endpoint;
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      leaseReaper.stop();
      vault.close();
      await manifestWatcher.close();
      await httpServer.close();
      database.close();
    }
  };
}

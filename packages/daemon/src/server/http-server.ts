import { createServer, type Server } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation
} from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpSessionRouter } from "./mcp-transport.js";
import type { ApprovalService } from "../approval/approval-service.js";
import type { ApprovalEventHub } from "../approval/event-hub.js";
import { createDashboardApi } from "./dashboard-api.js";
import { attachApprovalWebSocket } from "./approval-websocket.js";
import { attachStudioWebSocket } from "./studio-websocket.js";
import type { DashboardService } from "../dashboard/dashboard-service.js";
import { serveDashboardAsset } from "./static-dashboard.js";
import type { CloudIntelligenceService } from "../cloud/cloud-intelligence-service.js";
import type { StudioService } from "../studio/studio-service.js";
import type { CoordinationService } from "../coordination/coordination-service.js";

export interface StartedHttpServer {
  host: string;
  port: number;
  mcpUrl: string;
  dashboardUrl: string;
}

export interface BelayHttpServer {
  start(): Promise<StartedHttpServer>;
  close(): Promise<void>;
  readonly rawServer: Server;
}

export function createBelayHttpServer(options: {
  host: "127.0.0.1";
  port: number;
  mcpServerFactory: () => McpServer;
  approvals: ApprovalService;
  coordination: CoordinationService;
  cloudIntelligence: CloudIntelligenceService;
  approvalEvents: ApprovalEventHub;
  dashboardSessionToken: string;
  dashboard: DashboardService;
  studio: StudioService;
  dashboardDirectory: string;
}): BelayHttpServer {
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const mcpRouter = createMcpSessionRouter(options.mcpServerFactory);
  const dashboardApi = createDashboardApi(
    options.approvals,
    options.coordination,
    options.cloudIntelligence,
    options.dashboard,
    options.studio,
    options.dashboardSessionToken,
    () => mcpRouter.sessionCount
  );

  const rawServer = createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) {
      return;
    }
    if (req.headers["x-forwarded-host"] || req.headers["x-forwarded-for"]) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Forwarded routing headers are not trusted." }));
      return;
    }

    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? options.host}`);
    if (requestUrl.pathname === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ status: "ok", service: "belay" }));
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      void dashboardApi(req, res, requestUrl).then((handled) => {
        if (!handled && !res.headersSent) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
      }).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Dashboard request failed." }));
        }
      });
      return;
    }
    if (requestUrl.pathname !== "/mcp") {
      if (req.method === "GET" && serveDashboardAsset(
        requestUrl.pathname,
        res,
        options.dashboardDirectory,
        options.dashboardSessionToken
      )) {
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    void mcpRouter.handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal MCP transport error." },
            id: null
          })
        );
      } else {
        res.end();
      }
    });
  });
  const closeApprovalWebSocket = attachApprovalWebSocket(
    rawServer,
    options.approvalEvents,
    options.dashboardSessionToken
  );
  const studioWebSocket = attachStudioWebSocket(
    rawServer,
    options.dashboardSessionToken
  );
  const stopStudioBroadcast = options.studio.onMessage((sessionId, message) => {
    studioWebSocket.broadcast({ type: "studio.message", sessionId, message });
  });

  return {
    rawServer,

    async start() {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          rawServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          rawServer.off("error", onError);
          resolve();
        };
        rawServer.once("error", onError);
        rawServer.once("listening", onListening);
        rawServer.listen(options.port, options.host);
      });

      const address = rawServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to determine HTTP server port.");
      }
      const port = address.port;
      return {
        host: options.host,
        port,
        mcpUrl: `http://${options.host}:${port}/mcp`,
        dashboardUrl: `http://${options.host}:${port}/`
      };
    },

    async close() {
      closeApprovalWebSocket();
      stopStudioBroadcast();
      studioWebSocket.close();
      await mcpRouter.close();
      rawServer.closeAllConnections();
      if (!rawServer.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        rawServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

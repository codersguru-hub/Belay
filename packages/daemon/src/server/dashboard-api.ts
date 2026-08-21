import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ApprovalDecisionInputSchema,
  CloudSummaryCommandSchema,
  CreateStudioSessionInputSchema,
  FleetTaskDecompositionCommandSchema,
  StageFleetTaskPlanCommandSchema,
  StudioPromptInputSchema
} from "@belay/contracts";
import type { ApprovalService } from "../approval/approval-service.js";
import type { CoordinationService } from "../coordination/coordination-service.js";
import type { DashboardService } from "../dashboard/dashboard-service.js";
import type { StudioService } from "../studio/studio-service.js";
import { CoordinationError, toToolError } from "../coordination/errors.js";
import {
  CloudIntelligenceService,
  CloudIntelligenceUnavailableError
} from "../cloud/cloud-intelligence-service.js";

const MAX_BODY_BYTES = 16 * 1024;
const PROMPT_BODY_BYTES = 128 * 1024;

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function tokenMatches(req: IncomingMessage, expected: string): boolean {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const cookie = String(req.headers.cookie ?? "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("belay_session="))
    ?.slice("belay_session=".length);
  const candidate = bearer ?? cookie;
  if (!candidate) return false;
  const actualHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  if (req.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("CONTENT_TYPE");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function createDashboardApi(
  approvals: ApprovalService,
  coordination: CoordinationService,
  cloudIntelligence: CloudIntelligenceService,
  dashboard: DashboardService,
  studio: StudioService,
  sessionToken: string,
  sessionCount: () => number
): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      writeJson(res, 200, dashboard.snapshot(sessionCount()));
      return true;
    }

    // Studio endpoints
    if (req.method === "GET" && url.pathname === "/api/studio/sessions") {
      const projectId = cloudIntelligence.projectId() ?? "";
      writeJson(res, 200, { sessions: studio.listSessions(projectId) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/studio/sessions") {
      if (!tokenMatches(req, sessionToken)) {
        writeJson(res, 401, { error: "A valid local session token is required." });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJson(req);
      } catch {
        writeJson(res, 400, { error: "The request body is invalid." });
        return true;
      }
      const input = CreateStudioSessionInputSchema.safeParse(parsed);
      if (!input.success) {
        writeJson(res, 400, { error: "The session parameters are invalid." });
        return true;
      }
      writeJson(res, 201, studio.createSession(input.data));
      return true;
    }

    const sessionMatch = /^\/api\/studio\/sessions\/([^/]+)$/u.exec(url.pathname);
    if (req.method === "GET" && sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
      const session = studio.getSession(sessionId);
      if (!session) {
        writeJson(res, 404, { error: "Studio session not found." });
        return true;
      }
      writeJson(res, 200, session);
      return true;
    }

    const promptMatch = /^\/api\/studio\/sessions\/([^/]+)\/prompt$/u.exec(url.pathname);
    if (req.method === "POST" && promptMatch) {
      if (!tokenMatches(req, sessionToken)) {
        writeJson(res, 401, { error: "A valid local session token is required." });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJson(req, PROMPT_BODY_BYTES);
      } catch {
        writeJson(res, 400, { error: "The prompt body is invalid." });
        return true;
      }
      const input = StudioPromptInputSchema.safeParse(parsed);
      if (!input.success) {
        writeJson(res, 400, { error: "The prompt input parameters are invalid." });
        return true;
      }
      const sessionId = decodeURIComponent(promptMatch[1] ?? "");
      try {
        const result = await studio.dispatchPrompt(sessionId, input.data);
        writeJson(res, 200, result);
      } catch (error) {
        writeJson(res, 500, { error: "Prompt dispatch failed." });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/studio/diff") {
      writeJson(res, 200, { diffs: studio.getDiff() });
      return true;
    }

    const fleetPlanMatch = /^\/api\/projects\/([^/]+)\/fleet-plan$/u.exec(url.pathname);
    if (req.method === "POST" && fleetPlanMatch) {
      if (!tokenMatches(req, sessionToken)) {
        writeJson(res, 401, { error: "A valid local session token is required." });
        return true;
      }
      if (decodeURIComponent(fleetPlanMatch[1] ?? "") !== cloudIntelligence.projectId()) {
        writeJson(res, 404, { error: "Project not found." });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJson(req);
      } catch {
        writeJson(res, 400, { error: "The fleet goal is invalid." });
        return true;
      }
      const command = FleetTaskDecompositionCommandSchema.safeParse(parsed);
      if (!command.success) {
        writeJson(res, 400, { error: "The fleet goal is invalid." });
        return true;
      }
      try {
        writeJson(res, 200, await cloudIntelligence.decomposeFleetTask(command.data.goal));
      } catch (error) {
        writeJson(res, error instanceof CloudIntelligenceUnavailableError ? 503 : 500, {
          error: "Gemini fleet planning is unavailable; local coordination remains active."
        });
      }
      return true;
    }

    const stageFleetPlanMatch = /^\/api\/projects\/([^/]+)\/fleet-plan\/stage$/u.exec(url.pathname);
    if (req.method === "POST" && stageFleetPlanMatch) {
      if (!tokenMatches(req, sessionToken)) {
        writeJson(res, 401, { error: "A valid local session token is required." });
        return true;
      }
      if (decodeURIComponent(stageFleetPlanMatch[1] ?? "") !== cloudIntelligence.projectId()) {
        writeJson(res, 404, { error: "Project not found." });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJson(req);
      } catch {
        writeJson(res, 400, { error: "The fleet lease request is invalid." });
        return true;
      }
      const command = StageFleetTaskPlanCommandSchema.safeParse(parsed);
      const plan = command.success ? cloudIntelligence.fleetTaskPlan(command.data.planId) : undefined;
      if (!command.success || !plan) {
        writeJson(res, 409, { error: "The Gemini fleet plan is unavailable or no longer current." });
        return true;
      }
      try {
        writeJson(res, 200, coordination.stageFleetTaskPlan({
          projectRoot: cloudIntelligence.localProjectRoot(),
          plan,
          leaseSeconds: command.data.leaseSeconds
        }));
      } catch (error) {
        writeJson(res, 409, toToolError(error, "fleet-plan-stage"));
      }
      return true;
    }

    const auditMatch = /^\/api\/projects\/([^/]+)\/audit$/u.exec(url.pathname);
    if (req.method === "GET" && auditMatch) {
      writeJson(res, 200, {
        audit: dashboard.audit(decodeURIComponent(auditMatch[1] ?? ""))
      });
      return true;
    }

    const listMatch = /^\/api\/projects\/([^/]+)\/approvals$/u.exec(url.pathname);
    if (req.method === "GET" && listMatch) {
      const projectId = decodeURIComponent(listMatch[1] ?? "");
      if (url.searchParams.get("status") !== "pending") {
        writeJson(res, 400, { error: "Only the pending approval projection is supported." });
        return true;
      }
      writeJson(res, 200, { approvals: approvals.listPending(projectId) });
      return true;
    }

    const decisionMatch = /^\/api\/approvals\/([^/]+)\/decision$/u.exec(url.pathname);
    if (req.method === "POST" && decisionMatch) {
      if (!tokenMatches(req, sessionToken)) {
        writeJson(res, 401, { error: "A valid local session token is required." });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJson(req);
      } catch {
        writeJson(res, 400, { error: "The decision body is invalid." });
        return true;
      }
      const input = ApprovalDecisionInputSchema.safeParse(parsed);
      if (!input.success) {
        writeJson(res, 400, { error: "The decision body is invalid." });
        return true;
      }
      try {
        const result = await approvals.decide(
          decodeURIComponent(decisionMatch[1] ?? ""),
          input.data
        );
        writeJson(res, 200, result);
      } catch (error) {
        const toolError = toToolError(error, "dashboard-request");
        const status = error instanceof CoordinationError && error.code === "APPROVAL_NOT_FOUND"
          ? 404
          : 409;
        writeJson(res, status, toolError);
      }
      return true;
    }

    const cloudMatch = /^\/api\/projects\/([^/]+)\/cloud-summary$/u.exec(url.pathname);
    if (req.method === "POST" && cloudMatch) {
      if (!tokenMatches(req, sessionToken)) {
        writeJson(res, 401, { error: "A valid local session token is required." });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJson(req);
      } catch {
        writeJson(res, 400, { error: "The cloud summary request is invalid." });
        return true;
      }
      const command = CloudSummaryCommandSchema.safeParse(parsed);
      if (!command.success || command.data.kind !== "manifest_summary") {
        writeJson(res, 400, { error: "Only a manifest summary is currently supported." });
        return true;
      }
      if (decodeURIComponent(cloudMatch[1] ?? "") !== cloudIntelligence.projectId()) {
        writeJson(res, 404, { error: "Project not found." });
        return true;
      }
      try {
        writeJson(res, 200, await cloudIntelligence.summarizeManifest());
      } catch (error) {
        writeJson(res, error instanceof CloudIntelligenceUnavailableError ? 503 : 500, {
          error: "Cloud intelligence is unavailable; local controls remain active."
        });
      }
      return true;
    }
    return false;
  };
}

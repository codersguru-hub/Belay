import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  CLOUD_SUMMARY_MAX_BYTES,
  FleetTaskDecompositionRequestV1Schema,
  FleetTaskPlanResponseSchema,
  CloudSummaryRequestV1Schema,
  CloudSummaryResponseSchema,
  type FleetTaskDecompositionRequestV1,
  type CloudSummaryRequestV1
} from "@belay/contracts";
import { vertexAI } from "@genkit-ai/google-genai";
import { genkit, z } from "genkit";

const MODEL = process.env.BELAY_GEMINI_MODEL ?? "gemini-3.6-flash";
const LOCATION = process.env.GCLOUD_LOCATION ?? "global";
const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);

const ai = genkit({
  plugins: [vertexAI({ location: LOCATION })],
  model: vertexAI.model(MODEL)
});

const SummaryOutputSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    riskLevel: z.enum(["low", "medium", "high"]).optional()
  })
  .strict();

const FleetPlanOutputSchema = z
  .object({
    // Keep the generation schema within Vertex AI's supported JSON-schema subset.
    // The shared contract below performs all bounds, enum, slug, DAG, and path checks.
    goalSummary: z.string(),
    tasks: z
      .array(
        z
          .object({
            taskId: z.string(),
            title: z.string(),
            assignedAgent: z.string(),
            leasePaths: z.array(z.string()),
            dependsOn: z.array(z.string()),
            acceptanceCriteria: z.array(z.string()),
            riskLevel: z.string()
          })
          .strict()
      )
  })
  .strict();

const summarizeFlow = ai.defineFlow(
  {
    name: "belayPrivacyFilteredSummary",
    inputSchema: z.any(),
    outputSchema: SummaryOutputSchema
  },
  async (input) => {
    const safeInput = CloudSummaryRequestV1Schema.parse(input);
    const task =
      safeInput.kind === "lock_conflict_advice"
        ? [
            "This request describes a file-lock collision between independent coding agents.",
            "`heldPaths` are files already leased by another agent (with the exported symbol kinds each file declares);",
            "`availablePaths` are the requester's remaining uncontended files.",
            "Explain what work most likely overlaps based on the paths and symbol kinds, then recommend a concrete",
            "non-conflicting next step for the requester — normally proceeding on `availablePaths` first, or waiting when",
            "the contended files are structurally inseparable from the rest. Address the requester directly and be specific",
            "about which paths you mean. You are advisory only: never instruct the requester to bypass, steal, or force a lock."
          ].join(" ")
        : "Produce a concise operational summary of the supplied structural metadata or sanitized audit aliases.";

    const response = await ai.generate({
      system:
        "You are Belay cloud intelligence. Analyze only the supplied structural metadata, sanitized aliases, and repository-relative paths. Never request source code, secrets, credentials, tools, callbacks, or execution. Return a concise operational summary and an advisory risk label. " +
        task,
      prompt: JSON.stringify(safeInput),
      output: { schema: SummaryOutputSchema }
    });
    if (!response.output) throw new Error("Gemini returned no structured output.");
    return response.output;
  }
);

const decomposeFleetTaskFlow = ai.defineFlow(
  {
    name: "belayFleetTaskDecomposition",
    inputSchema: z.any(),
    outputSchema: FleetPlanOutputSchema
  },
  async (input) => {
    const safeInput = FleetTaskDecompositionRequestV1Schema.parse(input);
    const response = await ai.generate({
      system: [
        "You are the Belay Cloud Arbiter and Fleet Intelligence Engine.",
        "Decompose the high-level goal into a small executable plan for the supplied agent fleet.",
        "Use only candidatePaths present in the structural manifest; never invent, normalize, or broaden a path.",
        "Every path must be leased by exactly one task, and tasks must have unique kebab-case identifiers.",
        "Assign implementation-heavy work to codex, architecture/review work to claude-code, and integration or",
        "Google-stack work to antigravity when those agents are available. Dependencies must reference task IDs",
        "from the same response. Never request source code, secrets, credentials, tools, callbacks, or execution.",
        "The plan is advisory: the local SQLite-WAL authority will independently validate and enforce every lease."
      ].join(" "),
      prompt: JSON.stringify(safeInput),
      output: { schema: FleetPlanOutputSchema }
    });
    if (!response.output) throw new Error("Gemini returned no structured fleet plan.");
    return response.output;
  }
);

const forbiddenValue = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/]+:[^\s/@]+@/iu
] as const;

function containsForbiddenValue(value: unknown): boolean {
  if (typeof value === "string") return forbiddenValue.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsForbiddenValue);
  if (value && typeof value === "object") return Object.values(value).some(containsForbiddenValue);
  return false;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > CLOUD_SUMMARY_MAX_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function allowedRequestId(req: IncomingMessage): string {
  const candidate = req.headers["x-belay-request-id"];
  return typeof candidate === "string" && /^[0-9a-f-]{36}$/iu.test(candidate)
    ? candidate
    : randomUUID();
}

async function summarize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = allowedRequestId(req);
  try {
    const candidate = await readJson(req);
    const parsed = CloudSummaryRequestV1Schema.safeParse(candidate);
    if (!parsed.success || containsForbiddenValue(candidate)) {
      writeJson(res, 400, { error: "Payload rejected by the cloud privacy boundary.", requestId });
      return;
    }
    const output = await summarizeFlow(parsed.data as CloudSummaryRequestV1);
    const result = CloudSummaryResponseSchema.parse({
      requestId,
      model: MODEL,
      summary: output.summary,
      ...(output.riskLevel ? { riskLevel: output.riskLevel } : {}),
      generatedAt: new Date().toISOString()
    });
    console.info(JSON.stringify({
      event: "gemini_summary_completed",
      requestId,
      model: MODEL,
      kind: parsed.data.kind,
      status: "succeeded"
    }));
    writeJson(res, 200, result);
  } catch {
    console.error(JSON.stringify({ event: "gemini_summary_failed", requestId, status: "failed" }));
    writeJson(res, 502, { error: "Cloud summary failed.", requestId });
  }
}

function validateFleetPlanAgainstRequest(
  request: FleetTaskDecompositionRequestV1,
  output: z.infer<typeof FleetPlanOutputSchema>
): void {
  const allowedAgents = new Set<string>(request.agents);
  const allowedPaths = new Set(request.manifest.candidatePaths.map((entry) => entry.path));
  for (const task of output.tasks) {
    if (!allowedAgents.has(task.assignedAgent)) {
      throw new Error("Gemini selected an unavailable fleet agent.");
    }
    for (const path of task.leasePaths) {
      if (!allowedPaths.has(path)) {
        throw new Error("Gemini selected a path outside the sanitized manifest.");
      }
    }
  }
}

async function decomposeFleetTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = allowedRequestId(req);
  try {
    const candidate = await readJson(req);
    const parsed = FleetTaskDecompositionRequestV1Schema.safeParse(candidate);
    if (!parsed.success || containsForbiddenValue(candidate)) {
      writeJson(res, 400, { error: "Payload rejected by the cloud privacy boundary.", requestId });
      return;
    }
    const output = await decomposeFleetTaskFlow(parsed.data);
    validateFleetPlanAgainstRequest(parsed.data, output);
    const result = FleetTaskPlanResponseSchema.parse({
      requestId,
      planId: randomUUID(),
      model: MODEL,
      goalSummary: output.goalSummary,
      tasks: output.tasks,
      generatedAt: new Date().toISOString()
    });
    console.info(JSON.stringify({
      event: "gemini_fleet_plan_completed",
      requestId,
      planId: result.planId,
      model: MODEL,
      taskCount: result.tasks.length,
      status: "succeeded"
    }));
    writeJson(res, 200, result);
  } catch {
    console.error(JSON.stringify({ event: "gemini_fleet_plan_failed", requestId, status: "failed" }));
    writeJson(res, 502, { error: "Fleet task decomposition failed.", requestId });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://belay-cloud");
  if (req.method === "GET" && url.pathname === "/healthz") {
    writeJson(res, 200, { status: "ok", service: "belay-cloud-intelligence", model: MODEL });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/summarize") {
    void summarize(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/decompose-fleet-task") {
    void decomposeFleetTask(req, res);
    return;
  }
  writeJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "service_started", port: PORT, model: MODEL, location: LOCATION }));
});

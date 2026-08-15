import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  CLOUD_SUMMARY_MAX_BYTES,
  CloudSummaryRequestV1Schema,
  CloudSummaryResponseSchema,
  type CloudSummaryRequestV1
} from "@agentmesh/contracts";
import { vertexAI } from "@genkit-ai/google-genai";
import { genkit, z } from "genkit";

const MODEL = process.env.AGENTMESH_GEMINI_MODEL ?? "gemini-3.6-flash";
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

const summarizeFlow = ai.defineFlow(
  {
    name: "agentmeshPrivacyFilteredSummary",
    inputSchema: z.any(),
    outputSchema: SummaryOutputSchema
  },
  async (input) => {
    const safeInput = CloudSummaryRequestV1Schema.parse(input);
    const response = await ai.generate({
      system:
        "You are AgentMesh cloud intelligence. Analyze only the supplied structural metadata or sanitized audit aliases. Never request source code, secrets, credentials, tools, callbacks, or execution. Return a concise operational summary and an advisory risk label.",
      prompt: JSON.stringify(safeInput),
      output: { schema: SummaryOutputSchema }
    });
    if (!response.output) throw new Error("Gemini returned no structured output.");
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
  const candidate = req.headers["x-agentmesh-request-id"];
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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://agentmesh-cloud");
  if (req.method === "GET" && url.pathname === "/healthz") {
    writeJson(res, 200, { status: "ok", service: "agentmesh-cloud-intelligence", model: MODEL });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/summarize") {
    void summarize(req, res);
    return;
  }
  writeJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "service_started", port: PORT, model: MODEL, location: LOCATION }));
});

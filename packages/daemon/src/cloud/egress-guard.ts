import { createHash } from "node:crypto";
import {
  CLOUD_SUMMARY_MAX_BYTES,
  FleetTaskDecompositionRequestV1Schema,
  CloudSummaryRequestV1Schema,
  type FleetTaskDecompositionRequestV1,
  type CloudSummaryRequestV1
} from "@belay/contracts";

const FORBIDDEN_KEY = /(?:^|_)(?:body|code|content|credential|database_url|private_key|raw|secret|source|token)(?:$|_)/iu;
const FORBIDDEN_VALUE_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/iu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/]+:[^\s/@]+@/iu,
  /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|id_(?:rsa|ed25519)|[^\\/]+\.(?:key|pem))(?:$|[\\/])/iu
] as const;

export type EgressRejectionCode =
  | "SCHEMA_REJECTED"
  | "PAYLOAD_TOO_LARGE"
  | "FORBIDDEN_CONTENT";

export class EgressRejectedError extends Error {
  constructor(readonly code: EgressRejectionCode) {
    super(`Cloud egress rejected: ${code}`);
    this.name = "EgressRejectedError";
  }
}

export interface AllowedEgress {
  payload: CloudSummaryRequestV1 | FleetTaskDecompositionRequestV1;
  canonicalJson: string;
  payloadHash: string;
  byteSize: number;
  fieldCounts: {
    frameworks: number;
    scripts: number;
    ports: number;
    topology: number;
    audit: number;
    conflictHeldPaths: number;
    fleetCandidatePaths: number;
    fleetAgents: number;
  };
}

function encodedVariants(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  return [
    value,
    bytes.toString("base64"),
    bytes.toString("base64url"),
    bytes.toString("hex"),
    encodeURIComponent(value)
  ];
}

function walk(value: unknown, visit: (key: string | undefined, value: string) => void, key?: string): void {
  if (typeof value === "string") {
    visit(key, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (typeof childValue === "string") visit(childKey, childValue);
      else walk(childValue, visit, childKey);
    }
  }
}

export class EgressGuard {
  private readonly secretVariants: string[];

  constructor(knownSecrets: readonly string[] = []) {
    this.secretVariants = knownSecrets
      .filter((value) => Buffer.byteLength(value, "utf8") >= 8)
      .flatMap(encodedVariants);
  }

  inspect(candidate: unknown): AllowedEgress {
    let untrustedJson: string;
    try {
      untrustedJson = JSON.stringify(candidate);
    } catch {
      throw new EgressRejectedError("SCHEMA_REJECTED");
    }
    if (Buffer.byteLength(untrustedJson, "utf8") > CLOUD_SUMMARY_MAX_BYTES) {
      throw new EgressRejectedError("PAYLOAD_TOO_LARGE");
    }

    let forbidden = false;
    walk(candidate, (key, value) => {
      if (key && FORBIDDEN_KEY.test(key)) forbidden = true;
      if (FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))) forbidden = true;
      if (this.secretVariants.some((secret) => secret.length > 0 && value.includes(secret))) forbidden = true;
    });
    if (forbidden) throw new EgressRejectedError("FORBIDDEN_CONTENT");

    const summary = CloudSummaryRequestV1Schema.safeParse(candidate);
    const fleet = summary.success
      ? undefined
      : FleetTaskDecompositionRequestV1Schema.safeParse(candidate);
    const parsed = summary.success ? summary : fleet;
    if (!parsed?.success) throw new EgressRejectedError("SCHEMA_REJECTED");
    const canonicalJson = JSON.stringify(parsed.data);
    const byteSize = Buffer.byteLength(canonicalJson, "utf8");
    if (byteSize > CLOUD_SUMMARY_MAX_BYTES) {
      throw new EgressRejectedError("PAYLOAD_TOO_LARGE");
    }
    const fieldCounts = parsed.data.kind === "fleet_task_decomposition"
      ? {
          frameworks: parsed.data.manifest.frameworks.length,
          scripts: 0,
          ports: 0,
          topology: 0,
          audit: 0,
          conflictHeldPaths: 0,
          fleetCandidatePaths: parsed.data.manifest.candidatePaths.length,
          fleetAgents: parsed.data.agents.length
        }
      : {
          frameworks: parsed.data.manifest?.frameworks.length ?? 0,
          scripts: parsed.data.manifest?.scripts.length ?? 0,
          ports: parsed.data.manifest?.ports.length ?? 0,
          topology: parsed.data.manifest?.topology.length ?? 0,
          audit: parsed.data.audit?.length ?? 0,
          conflictHeldPaths: parsed.data.conflict?.heldPaths.length ?? 0,
          fleetCandidatePaths: 0,
          fleetAgents: 0
        };
    return {
      payload: parsed.data,
      canonicalJson,
      payloadHash: createHash("sha256").update(canonicalJson).digest("hex"),
      byteSize,
      fieldCounts
    };
  }
}

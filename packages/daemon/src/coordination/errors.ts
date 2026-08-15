import type { ToolError, ToolErrorCode } from "@agentmesh/contracts";

export class CoordinationError extends Error {
  readonly code: ToolErrorCode;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: {
    code: ToolErrorCode;
    message: string;
    correlationId: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "CoordinationError";
    this.code = options.code;
    this.correlationId = options.correlationId;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function toToolError(error: unknown, fallbackCorrelationId: string): ToolError {
  if (error instanceof CoordinationError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      correlationId: error.correlationId,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {})
    };
  }

  const databaseCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (databaseCode.startsWith("SQLITE_BUSY") || databaseCode.startsWith("SQLITE_LOCKED")) {
    return {
      ok: false,
      code: "DATABASE_BUSY",
      message: "The coordination database is busy; retry the request.",
      correlationId: fallbackCorrelationId,
      retryable: true
    };
  }

  return {
    ok: false,
    code: "INTERNAL_ERROR",
    message: "AgentMesh could not complete the request.",
    correlationId: fallbackCorrelationId,
    retryable: false
  };
}

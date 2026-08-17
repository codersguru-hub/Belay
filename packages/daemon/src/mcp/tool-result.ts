import { randomUUID } from "node:crypto";
import type { ToolError } from "@agentmesh/contracts";
import { toToolError } from "../coordination/errors.js";

type StructuredToolValue = Record<string, unknown>;

function asStructuredValue(value: object): StructuredToolValue {
  return value as StructuredToolValue;
}

function successSummary(value: StructuredToolValue): string {
  if (value.status === "pending" && typeof value.approvalId === "string") {
    if (value.actionKind === "knowledge" && value.knowledge && typeof value.knowledge === "object") {
      const knowledge = value.knowledge as Record<string, unknown>;
      return `Knowledge proposal ${String(knowledge.knowledgeId)} is pending human approval until ${String(value.expiresAt)}.`;
    }
    return `Action ${String(value.commandId)} is pending human approval until ${String(value.expiresAt)}.`;
  }
  if (typeof value.commandId === "string" && typeof value.status === "string") {
    return `Registered command ${value.commandId} finished with status ${value.status}.`;
  }
  if (typeof value.version === "string" && typeof value.estimatedTokens === "number") {
    return `Project manifest ${value.version.slice(0, 12)} generated in ${String(value.durationMs)}ms using approximately ${String(value.estimatedTokens)} token(s).`;
  }
  if (value.status === "in_progress" && typeof value.heartbeatAt === "string") {
    return `Task ${String(value.taskId)} heartbeat accepted through ${String(value.leaseExpiresAt)}.`;
  }
  if (value.status === "in_progress" && typeof value.progressAt === "string") {
    return `Progress recorded for task ${String(value.taskId)}.`;
  }
  if (value.status === "blocked" && typeof value.blockedAt === "string") {
    const releasedFiles = Array.isArray(value.releasedFiles) ? value.releasedFiles.length : 0;
    return `Task ${String(value.taskId)} blocked; ${releasedFiles} lock(s) released.`;
  }
  if (value.item && typeof value.item === "object") {
    const item = value.item as Record<string, unknown>;
    return `Checklist item ${String(item.id)} is ${String(item.status)}.`;
  }
  if (Array.isArray(value.items) && typeof value.omittedItems === "number") {
    if (value.workspace && typeof value.workspace === "object") {
      return `Shared knowledge contains ${value.items.length} visible fact(s); ${value.omittedItems} omitted.`;
    }
    return `Shared checklist contains ${value.items.length} item(s); ${value.omittedItems} omitted.`;
  }
  if (value.status === "in_progress") {
    const lockedFiles = Array.isArray(value.lockedFiles) ? value.lockedFiles.length : 0;
    return `Task ${String(value.taskId)} acquired with ${lockedFiles} file lock(s).`;
  }
  if (value.status === "completed") {
    const releasedFiles = Array.isArray(value.releasedFiles) ? value.releasedFiles.length : 0;
    return `Task ${String(value.taskId)} completed; ${releasedFiles} lock(s) released.`;
  }
  if (value.project && typeof value.project === "object") {
    const activeTasks = Array.isArray(value.activeTasks) ? value.activeTasks.length : 0;
    const checklist = Array.isArray(value.checklist) ? value.checklist.length : 0;
    const knowledge = value.knowledge && typeof value.knowledge === "object"
      ? (value.knowledge as { items?: unknown[] }).items?.length ?? 0
      : 0;
    const recentMemory = Array.isArray(value.recentMemory) ? value.recentMemory.length : 0;
    return `Stage context contains ${knowledge} approved fact(s), ${checklist} checklist item(s), ${activeTasks} active task(s), and ${recentMemory} recent activity event(s).`;
  }
  return "AgentMesh request completed.";
}

export function successfulToolResult(value: object) {
  const structuredContent = asStructuredValue(value);
  return {
    content: [{ type: "text" as const, text: successSummary(structuredContent) }],
    structuredContent
  };
}

export function failedToolResult(error: unknown) {
  const toolError: ToolError = toToolError(error, randomUUID());
  return {
    content: [
      {
        type: "text" as const,
        text: `${toolError.code}: ${toolError.message} (${toolError.correlationId})`
      }
    ],
    structuredContent: asStructuredValue(toolError),
    isError: true
  };
}

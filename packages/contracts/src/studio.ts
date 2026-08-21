import { z } from "zod";
import { ProjectIdSchema } from "./ids.js";

export const StudioAgentTargetSchema = z.enum(["antigravity", "codex", "claude", "team"]);
export type StudioAgentTarget = z.infer<typeof StudioAgentTargetSchema>;

export const StudioSessionSchema = z.object({
  id: z.string().min(1).max(128),
  projectId: ProjectIdSchema,
  title: z.string().trim().min(1).max(200),
  activeAgent: StudioAgentTargetSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();
export type StudioSession = z.infer<typeof StudioSessionSchema>;

export const StudioDiffHunkSchema = z.object({
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  content: z.string()
}).strict();
export type StudioDiffHunk = z.infer<typeof StudioDiffHunkSchema>;

export const StudioDiffPayloadSchema = z.object({
  filePath: z.string().min(1).max(1024),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  status: z.enum(["modified", "added", "deleted", "renamed"]).default("modified"),
  hunks: z.array(StudioDiffHunkSchema).default([])
}).strict();
export type StudioDiffPayload = z.infer<typeof StudioDiffPayloadSchema>;

export const StudioMessageSchema = z.object({
  id: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(100_000),
  agentName: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  diffs: z.array(StudioDiffPayloadSchema).optional(),
  approvalId: z.string().max(128).optional(),
  createdAt: z.string().datetime()
}).strict();
export type StudioMessage = z.infer<typeof StudioMessageSchema>;

export const StudioPromptInputSchema = z.object({
  targetAgent: StudioAgentTargetSchema.default("antigravity"),
  prompt: z.string().trim().min(1).max(64_000),
  model: z.string().trim().min(1).max(128).optional(),
  contextAttachments: z.array(z.string().min(1).max(1024)).max(20).optional()
}).strict();
export type StudioPromptInput = z.infer<typeof StudioPromptInputSchema>;

export const CreateStudioSessionInputSchema = z.object({
  projectId: ProjectIdSchema,
  title: z.string().trim().min(1).max(200).default("New Session"),
  activeAgent: StudioAgentTargetSchema.default("antigravity")
}).strict();
export type CreateStudioSessionInput = z.infer<typeof CreateStudioSessionInputSchema>;

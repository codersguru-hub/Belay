import { z } from "zod";
import { KnowledgeIdSchema } from "./ids.js";
import { AgentNameSchema, RepositoryRootSchema } from "./mcp.js";

const visibleText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "must contain visible text only");

export const KnowledgeKindSchema = z.enum([
  "topology",
  "convention",
  "constraint",
  "pitfall",
  "glossary"
]);
export const KnowledgeScopeSchema = z.enum(["project", "workspace"]);

export const ProposeKnowledgeInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    knowledgeId: KnowledgeIdSchema,
    requester: AgentNameSchema,
    scope: KnowledgeScopeSchema.default("project"),
    kind: KnowledgeKindSchema,
    title: visibleText(200),
    body: visibleText(4000),
    priority: z.number().int().min(0).max(100).default(50),
    supersedesId: KnowledgeIdSchema.optional()
  })
  .strict();

export const ListKnowledgeInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    includeSuperseded: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(100)
  })
  .strict();

export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;
export type ProposeKnowledgeInput = z.infer<typeof ProposeKnowledgeInputSchema>;
export type ListKnowledgeInput = z.infer<typeof ListKnowledgeInputSchema>;

export interface KnowledgeApprovalPreview {
  knowledgeId: string;
  scope: KnowledgeScope;
  kind: KnowledgeKind;
  title: string;
  body: string;
  priority: number;
  supersedesId: string | null;
}

export interface KnowledgeItem extends KnowledgeApprovalPreview {
  workspaceId: string;
  projectId: string | null;
  proposedBy: string;
  approvalId: string;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeContextItem {
  id: string;
  scope: KnowledgeScope;
  kind: KnowledgeKind;
  title: string;
  body: string;
  bodyTruncated: boolean;
  priority: number;
  proposedBy: string;
  approvalId: string;
}

export interface ListKnowledgeResult {
  ok: true;
  workspace: { id: string; name: string };
  items: KnowledgeItem[];
  omittedItems: number;
  generatedAt: string;
}

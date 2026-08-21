import { z } from "zod";

export const CLOUD_SUMMARY_MAX_BYTES = 32 * 1024;

const AliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/u);

const ShortTextSchema = z.string().trim().min(1).max(160);

export const CloudManifestSchema = z
  .object({
    frameworks: z.array(ShortTextSchema).max(40),
    scripts: z.array(ShortTextSchema).max(80),
    ports: z
      .array(
        z
          .object({
            port: z.number().int().min(1).max(65_535),
            evidenceType: ShortTextSchema
          })
          .strict()
      )
      .max(40),
    topology: z
      .array(
        z
          .object({
            pathHashOrRelativePath: z.string().trim().min(1).max(512),
            symbolKinds: z.array(ShortTextSchema).max(80)
          })
          .strict()
      )
      .max(400),
    git: z
      .object({
        branch: z.string().trim().min(1).max(160),
        dirtyFileCount: z.number().int().min(0).max(1_000_000)
      })
      .strict()
  })
  .strict();

export const CloudAuditEventSchema = z
  .object({
    eventType: ShortTextSchema,
    agentAlias: AliasSchema,
    targetAlias: AliasSchema,
    outcome: ShortTextSchema,
    timestamp: z.iso.datetime()
  })
  .strict();

/**
 * Structural description of a file-lock collision. Carries only agent aliases,
 * repository-relative paths, and exported symbol kinds — never file bodies — so it
 * travels the same metadata-only egress boundary as the manifest projection.
 */
export const CloudLockConflictSchema = z
  .object({
    requesterAlias: AliasSchema,
    heldPaths: z
      .array(
        z
          .object({
            path: z.string().trim().min(1).max(512),
            holderAlias: AliasSchema,
            symbolKinds: z.array(ShortTextSchema).max(80).default([])
          })
          .strict()
      )
      .min(1)
      .max(200),
    availablePaths: z.array(z.string().trim().min(1).max(512)).max(200)
  })
  .strict();

export const CloudSummaryRequestV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["manifest_summary", "audit_risk_explanation", "lock_conflict_advice"]),
    projectAlias: AliasSchema,
    manifest: CloudManifestSchema.optional(),
    audit: z.array(CloudAuditEventSchema).max(200).optional(),
    conflict: CloudLockConflictSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const expected = {
      manifest_summary: "manifest",
      audit_risk_explanation: "audit",
      lock_conflict_advice: "conflict"
    } as const;
    const required = expected[value.kind];
    // Exactly one payload field may be present, and it must match the declared kind.
    for (const field of ["manifest", "audit", "conflict"] as const) {
      const present = value[field] !== undefined;
      if (field === required && !present) {
        context.addIssue({ code: "custom", message: `${value.kind} requires ${field}` });
      }
      if (field !== required && present) {
        context.addIssue({ code: "custom", message: `${value.kind} forbids ${field}` });
      }
    }
  });

export type CloudSummaryRequestV1 = z.infer<typeof CloudSummaryRequestV1Schema>;
export type CloudLockConflict = z.infer<typeof CloudLockConflictSchema>;

export const CloudSummaryResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    model: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2_000),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
    generatedAt: z.iso.datetime()
  })
  .strict();

export type CloudSummaryResponse = z.infer<typeof CloudSummaryResponseSchema>;

export const FleetAgentAliasSchema = z.enum(["claude-code", "codex", "antigravity"]);

const CloudRepositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:/u.test(value) &&
      !value.split(/[\\/]/u).some((segment) => segment === "" || segment === "." || segment === ".."),
    "must be a normalized repository-relative path"
  );

export const FleetTaskDecompositionRequestV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal("fleet_task_decomposition"),
    projectAlias: AliasSchema,
    goal: z.string().trim().min(8).max(1_200),
    agents: z.array(FleetAgentAliasSchema).min(2).max(3),
    manifest: z
      .object({
        frameworks: z.array(ShortTextSchema).max(40),
        candidatePaths: z
          .array(
            z
              .object({
                path: CloudRepositoryPathSchema,
                symbolKinds: z.array(ShortTextSchema).max(80)
              })
              .strict()
          )
          .min(1)
          .max(400),
        git: z
          .object({
            branch: z.string().trim().min(1).max(160),
            dirtyFileCount: z.number().int().min(0).max(1_000_000)
          })
          .strict()
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.agents).size !== value.agents.length) {
      context.addIssue({ code: "custom", message: "agents must be unique" });
    }
    const paths = value.manifest.candidatePaths.map((entry) => entry.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: "custom", message: "candidate paths must be unique" });
    }
  });

export type FleetTaskDecompositionRequestV1 = z.infer<
  typeof FleetTaskDecompositionRequestV1Schema
>;

export const FleetTaskPlanItemSchema = z
  .object({
    taskId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/u),
    title: z.string().trim().min(1).max(200),
    assignedAgent: FleetAgentAliasSchema,
    leasePaths: z.array(CloudRepositoryPathSchema).min(1).max(80),
    dependsOn: z
      .array(z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/u))
      .max(20),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    riskLevel: z.enum(["low", "medium", "high"])
  })
  .strict();

export const FleetTaskPlanResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    planId: z.string().uuid(),
    model: z.string().trim().min(1).max(160),
    goalSummary: z.string().trim().min(1).max(500),
    tasks: z.array(FleetTaskPlanItemSchema).min(1).max(12),
    generatedAt: z.iso.datetime()
  })
  .strict()
  .superRefine((value, context) => {
    const taskIds = value.tasks.map((task) => task.taskId);
    const taskIdSet = new Set(taskIds);
    if (taskIdSet.size !== taskIds.length) {
      context.addIssue({ code: "custom", message: "task identifiers must be unique" });
    }
    const leasedPaths = new Set<string>();
    for (const task of value.tasks) {
      if (new Set(task.leasePaths).size !== task.leasePaths.length) {
        context.addIssue({ code: "custom", message: `${task.taskId} repeats a lease path` });
      }
      for (const path of task.leasePaths) {
        if (leasedPaths.has(path)) {
          context.addIssue({ code: "custom", message: `${path} is assigned to multiple tasks` });
        }
        leasedPaths.add(path);
      }
      for (const dependency of task.dependsOn) {
        if (dependency === task.taskId || !taskIdSet.has(dependency)) {
          context.addIssue({ code: "custom", message: `${task.taskId} has an invalid dependency` });
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const dependencies = new Map(value.tasks.map((task) => [task.taskId, task.dependsOn]));
    const hasCycle = (taskId: string): boolean => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      for (const dependency of dependencies.get(taskId) ?? []) {
        if (hasCycle(dependency)) return true;
      }
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };
    if (taskIds.some(hasCycle)) {
      context.addIssue({ code: "custom", message: "task dependencies must be acyclic" });
    }
  });

export type FleetTaskPlanResponse = z.infer<typeof FleetTaskPlanResponseSchema>;

export const FleetTaskDecompositionCommandSchema = z
  .object({
    goal: z.string().trim().min(8).max(1_200)
  })
  .strict();

export const StageFleetTaskPlanCommandSchema = z
  .object({
    planId: z.string().uuid(),
    leaseSeconds: z.number().int().min(60).max(3_600).default(900)
  })
  .strict();

export const CloudSummaryCommandSchema = z
  .object({
    kind: z.enum(["manifest_summary", "audit_risk_explanation"])
  })
  .strict();

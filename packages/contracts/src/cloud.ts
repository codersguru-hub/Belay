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

export const CloudSummaryCommandSchema = z
  .object({
    kind: z.enum(["manifest_summary", "audit_risk_explanation"])
  })
  .strict();


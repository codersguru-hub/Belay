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

export const CloudSummaryRequestV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["manifest_summary", "audit_risk_explanation"]),
    projectAlias: AliasSchema,
    manifest: CloudManifestSchema.optional(),
    audit: z.array(CloudAuditEventSchema).max(200).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "manifest_summary" && (!value.manifest || value.audit)) {
      context.addIssue({
        code: "custom",
        message: "manifest_summary requires manifest and forbids audit"
      });
    }
    if (value.kind === "audit_risk_explanation" && (!value.audit || value.manifest)) {
      context.addIssue({
        code: "custom",
        message: "audit_risk_explanation requires audit and forbids manifest"
      });
    }
  });

export type CloudSummaryRequestV1 = z.infer<typeof CloudSummaryRequestV1Schema>;

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


import { z } from "zod";

const Base64Schema = z
  .string()
  .min(4)
  .max(2 * 1024 * 1024)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

export const EnvironmentVariableNameSchema = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]{0,127}$/u);

export const EnvironmentVariableDefinitionSchema = z
  .object({
    name: EnvironmentVariableNameSchema,
    description: z.string().trim().min(1).max(500),
    required: z.boolean(),
    validation: z
      .object({
        pattern: z.string().max(500).optional(),
        minimumLength: z.number().int().min(1).max(65_536).optional(),
        maximumLength: z.number().int().min(1).max(65_536).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const EnvironmentSchemaV1Schema = z
  .object({
    format: z.literal("belay-env-schema"),
    version: z.literal(1),
    profile: z.string().trim().min(1).max(80),
    variables: z.array(EnvironmentVariableDefinitionSchema).min(1).max(256)
  })
  .strict()
  .superRefine((schema, context) => {
    const names = new Set<string>();
    for (const [index, variable] of schema.variables.entries()) {
      if (names.has(variable.name)) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "name"],
          message: "Variable names must be unique."
        });
      }
      names.add(variable.name);
      const minimum = variable.validation?.minimumLength;
      const maximum = variable.validation?.maximumLength;
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "validation"],
          message: "minimumLength cannot exceed maximumLength."
        });
      }
    }
  });

export const VaultEnvelopeV1Schema = z
  .object({
    format: z.literal("belay-vault"),
    version: z.literal(1),
    cipher: z.literal("aes-256-gcm"),
    keyWrap: z.literal("age-ssh"),
    recipientFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    wrappedDek: Base64Schema,
    nonce: Base64Schema,
    ciphertext: Base64Schema,
    authTag: Base64Schema,
    aadHash: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.iso.datetime({ offset: true })
  })
  .strict();

export type EnvironmentVariableDefinition = z.infer<
  typeof EnvironmentVariableDefinitionSchema
>;
export type EnvironmentSchemaV1 = z.infer<typeof EnvironmentSchemaV1Schema>;
export type VaultEnvelopeV1 = z.infer<typeof VaultEnvelopeV1Schema>;

export type VaultState = "unconfigured" | "locked" | "unlocked";

export interface VaultStatus {
  state: VaultState;
  profile: string | null;
  recipientFingerprint: string | null;
  variableNames: string[];
  unlockedAt: string | null;
  expiresAt: string | null;
}

export const coordinationHardeningMigration = {
  version: 2,
  name: "coordination_hardening",
  sql: `
    ALTER TABLE tasks ADD COLUMN acquisition_fingerprint TEXT;
    ALTER TABLE tasks ADD COLUMN completion_fingerprint TEXT;
    ALTER TABLE tasks ADD COLUMN completion_result_json TEXT
      CHECK (completion_result_json IS NULL OR json_valid(completion_result_json));
  `
} as const;


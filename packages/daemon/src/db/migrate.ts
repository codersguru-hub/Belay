import type Database from "better-sqlite3";
import { coordinationMigration } from "./migrations/001_coordination.js";
import { coordinationHardeningMigration } from "./migrations/002_coordination_hardening.js";
import { manifestSnapshotsMigration } from "./migrations/003_manifest_snapshots.js";
import { commandRunsMigration } from "./migrations/004_command_runs.js";
import { approvalsMigration } from "./migrations/005_approvals.js";
import { cloudRequestsMigration } from "./migrations/006_cloud_requests.js";

const migrations = [
  coordinationMigration,
  coordinationHardeningMigration,
  manifestSnapshotsMigration,
  commandRunsMigration,
  approvalsMigration,
  cloudRequestsMigration
] as const;

interface AppliedMigrationRow {
  version: number;
}

export function migrateDatabase(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applyMigration = database.transaction(
    (migration: (typeof migrations)[number], appliedAt: string) => {
      const existing = database
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get(migration.version) as AppliedMigrationRow | undefined;

      if (existing) {
        return;
      }

      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        )
        .run(migration.version, migration.name, appliedAt);
    }
  );

  for (const migration of migrations) {
    applyMigration.immediate(migration, new Date().toISOString());
  }
}

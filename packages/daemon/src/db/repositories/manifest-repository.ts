import type Database from "better-sqlite3";
import type { ManifestSnapshot, ProjectManifestV1 } from "@belay/contracts";

interface ManifestSnapshotRow {
  project_id: string;
  version: string;
  canonical_json: string;
  byte_size: number;
  estimated_tokens: number;
  generated_at: string;
  duration_ms: number;
  stale: number;
}

function fromRow(row: ManifestSnapshotRow): ManifestSnapshot {
  return {
    projectId: row.project_id,
    version: row.version,
    canonicalJson: row.canonical_json,
    generatedAt: row.generated_at,
    durationMs: row.duration_ms,
    byteSize: row.byte_size,
    estimatedTokens: row.estimated_tokens,
    stale: row.stale === 1,
    manifest: JSON.parse(row.canonical_json) as ProjectManifestV1
  };
}

export function saveManifestSnapshot(
  database: Database.Database,
  snapshot: ManifestSnapshot
): void {
  const save = database.transaction(() => {
    database
      .prepare("UPDATE manifest_snapshots SET stale = 1 WHERE project_id = ?")
      .run(snapshot.projectId);
    database
      .prepare(
        `INSERT INTO manifest_snapshots (
          project_id, version, canonical_json, byte_size, estimated_tokens,
          generated_at, duration_ms, stale
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(project_id, version) DO UPDATE SET
          canonical_json = excluded.canonical_json,
          byte_size = excluded.byte_size,
          estimated_tokens = excluded.estimated_tokens,
          generated_at = excluded.generated_at,
          duration_ms = excluded.duration_ms,
          stale = 0`
      )
      .run(
        snapshot.projectId,
        snapshot.version,
        snapshot.canonicalJson,
        snapshot.byteSize,
        snapshot.estimatedTokens,
        snapshot.generatedAt,
        snapshot.durationMs
      );
  });
  save.immediate();
}

export function findLatestManifestSnapshot(
  database: Database.Database,
  projectId: string
): ManifestSnapshot | undefined {
  const row = database
    .prepare(
      `SELECT project_id, version, canonical_json, byte_size, estimated_tokens,
              generated_at, duration_ms, stale
       FROM manifest_snapshots
       WHERE project_id = ?
       ORDER BY generated_at DESC, id DESC
       LIMIT 1`
    )
    .get(projectId) as ManifestSnapshotRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function markLatestManifestStale(
  database: Database.Database,
  projectId: string
): void {
  database
    .prepare(
      `UPDATE manifest_snapshots SET stale = 1
       WHERE id = (
         SELECT id FROM manifest_snapshots
         WHERE project_id = ?
         ORDER BY generated_at DESC, id DESC
         LIMIT 1
       )`
    )
    .run(projectId);
}


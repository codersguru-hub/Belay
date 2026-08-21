import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openStateDatabase } from "../packages/daemon/dist/db/connection.js";
import { bootstrapProject } from "../packages/daemon/dist/db/repositories/project-repository.js";
import { ManifestService } from "../packages/daemon/dist/indexer/manifest-service.js";

const projectRoot = resolve(process.argv[2] ?? "tests/fixtures/demo-repo");
const stateDirectory = mkdtempSync(join(tmpdir(), "belay-indexer-benchmark-"));
const { database } = openStateDatabase(join(stateDirectory, "state.db"));

try {
  bootstrapProject(database, projectRoot);
  const manifests = new ManifestService(database);
  const runs = Array.from({ length: 3 }, () => manifests.indexProject(projectRoot));
  process.stdout.write(
    `${JSON.stringify({
      projectRoot,
      durationMs: runs.map((run) => Number(run.durationMs.toFixed(3))),
      byteSize: runs[2]?.byteSize,
      estimatedTokens: runs[2]?.estimatedTokens,
      version: runs[2]?.version,
      byteIdentical: runs.every((run) => run.canonicalJson === runs[0]?.canonicalJson)
    })}\n`
  );
} finally {
  database.close();
  rmSync(stateDirectory, { recursive: true, force: true });
}

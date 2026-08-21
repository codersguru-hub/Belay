import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openStateDatabase } from "../packages/daemon/src/db/connection.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";
import {
  MANIFEST_MAX_BYTES,
  ManifestService
} from "../packages/daemon/src/indexer/manifest-service.js";

const cleanupDirectories: string[] = [];
const cleanupDatabases: Database.Database[] = [];
const demoProjectRoot = resolve("tests/fixtures/demo-repo");

function createService(projectRoot: string) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "belay-indexer-state-"));
  cleanupDirectories.push(stateDirectory);
  const opened = openStateDatabase(join(stateDirectory, "state.db"));
  cleanupDatabases.push(opened.database);
  bootstrapProject(opened.database, projectRoot);
  return { ...opened, manifests: new ManifestService(opened.database) };
}

afterEach(() => {
  for (const database of cleanupDatabases.splice(0)) {
    try {
      database.close();
    } catch {
      // The test may already have closed the database after its assertions.
    }
  }
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("deterministic project indexer", () => {
  it("produces byte-identical, secret-safe manifests within the token budget", () => {
    const fixture = createService(demoProjectRoot);
    const snapshots = [
      fixture.manifests.indexProject(demoProjectRoot),
      fixture.manifests.indexProject(demoProjectRoot),
      fixture.manifests.indexProject(demoProjectRoot)
    ];
    const [first, second, third] = snapshots;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(second!.canonicalJson).toBe(first!.canonicalJson);
    expect(third!.canonicalJson).toBe(first!.canonicalJson);
    expect(new Set(snapshots.map((snapshot) => snapshot.version))).toHaveLength(1);
    expect(first!.byteSize).toBeLessThanOrEqual(MANIFEST_MAX_BYTES);
    expect(first!.estimatedTokens).toBeLessThanOrEqual(800);
    expect(Math.max(second!.durationMs, third!.durationMs)).toBeLessThan(100);

    expect(first!.manifest.project).toEqual(
      expect.objectContaining({
        name: "belay-indexer-fixture",
        packageManagers: ["npm"],
        workspacePatterns: ["packages/*"]
      })
    );
    expect(first!.manifest.frameworks).toEqual(["MCP Server", "Vite"]);
    expect(first!.manifest.scripts).toEqual(["dev", "serve", "test"]);
    expect(first!.manifest.ports).toEqual(
      expect.arrayContaining([
        { port: 4310, evidence: "script:serve" },
        { port: 5173, evidence: "script:dev" },
        { port: 5173, evidence: "config:vite.config.ts" }
      ])
    );
    expect(first!.manifest.configFiles).toEqual(["tsconfig.json", "vite.config.ts"]);
    expect(first!.manifest.topology).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/contracts.ts" }),
        expect.objectContaining({ path: "src/index.ts", imports: ["./contracts.js"] })
      ])
    );
    expect(first!.manifest.exclusions).toEqual(
      expect.objectContaining({ secretFiles: 1, binaryFiles: 1 })
    );
    expect(first!.canonicalJson).not.toContain("BELAY_CANARY_MUST_NEVER_APPEAR");
    expect(first!.canonicalJson).not.toContain("credentials.json");
    expect(first!.canonicalJson).not.toContain("logo.png");
    expect(first!.canonicalJson).not.toContain("generated.js");

    const storedRows = fixture.database
      .prepare("SELECT count(*) AS count FROM manifest_snapshots")
      .get() as { count: number };
    expect(storedRows.count).toBe(1);
    fixture.database.close();
  });

  it("truncates in a stable order and reports every topology omission", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "belay-large-project-"));
    cleanupDirectories.push(temporaryRoot);
    const projectRoot = join(temporaryRoot, "repo");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "large-fixture", scripts: { test: "vitest run" } })
    );
    for (let index = 0; index < 120; index += 1) {
      writeFileSync(
        join(projectRoot, "src", `module-${String(index).padStart(3, "0")}.ts`),
        `export function deterministicExport${index}(): number { return ${index}; }\n`
      );
    }

    const fixture = createService(projectRoot);
    const first = fixture.manifests.indexProject(projectRoot);
    const second = fixture.manifests.indexProject(projectRoot);
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.byteSize).toBeLessThanOrEqual(MANIFEST_MAX_BYTES);
    expect(first.estimatedTokens).toBeLessThanOrEqual(800);
    expect(first.manifest.omissions.truncated).toBe(true);
    expect(first.manifest.omissions.topology).toBeGreaterThan(0);
    expect(first.manifest.files.source).toBe(120);
    fixture.database.close();
  });

  it("prunes local tool and custom Belay state directories before traversal", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "belay-local-state-project-"));
    cleanupDirectories.push(temporaryRoot);
    const projectRoot = join(temporaryRoot, "repo");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(join(projectRoot, ".tools", "gcloud-config", "legacy_credentials"), {
      recursive: true
    });
    mkdirSync(join(projectRoot, ".belay-docs-qa"), { recursive: true });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "local-state-fixture" }));
    writeFileSync(join(projectRoot, "src", "index.ts"), "export const safe = true;\n");
    writeFileSync(
      join(projectRoot, ".tools", "gcloud-config", "legacy_credentials", "credentials.json"),
      "BELAY_LOCAL_TOOL_CANARY"
    );
    writeFileSync(join(projectRoot, ".belay-docs-qa", "state.db"), "BELAY_STATE_CANARY");

    const fixture = createService(projectRoot);
    const snapshot = fixture.manifests.indexProject(projectRoot);
    expect(snapshot.canonicalJson).not.toContain("BELAY_LOCAL_TOOL_CANARY");
    expect(snapshot.canonicalJson).not.toContain("BELAY_STATE_CANARY");
    expect(snapshot.manifest.exclusions.excludedDirectories).toBeGreaterThanOrEqual(2);
    fixture.database.close();
  });
});

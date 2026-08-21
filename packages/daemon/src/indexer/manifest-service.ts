import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { readFileSync, statSync } from "node:fs";
import type Database from "better-sqlite3";
import type {
  ManifestMetricsResult,
  ManifestSnapshot,
  ProjectManifestV1
} from "@belay/contracts";
import {
  findLatestManifestSnapshot,
  markLatestManifestStale,
  saveManifestSnapshot
} from "../db/repositories/manifest-repository.js";
import {
  canonicalizeProjectRoot,
  findProjectByRoot,
  type ProjectRow
} from "../db/repositories/project-repository.js";
import { CoordinationError } from "../coordination/errors.js";
import { canonicalJson } from "./canonical-json.js";
import {
  discoverProject,
  isBinaryPath,
  isSecretShapedPath
} from "./file-discovery.js";
import {
  isConfigPath,
  isSourcePath,
  MAX_INDEXED_FILE_BYTES,
  parsePackageMetadata,
  parsePorts,
  parseSourceTopology
} from "./parsers.js";

export const MANIFEST_MAX_BYTES = 3_200;

export interface ManifestServiceOptions {
  now?: () => Date;
  timer?: () => number;
}

function byteSize(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isJavaScriptFamily(projectPath: string): boolean {
  return /\.[cm]?[jt]sx?$/iu.test(projectPath);
}

function boundedManifest(manifest: ProjectManifestV1): { manifest: ProjectManifestV1; canonical: string } {
  const candidate = structuredClone(manifest);
  let canonical = canonicalJson(candidate);
  const removeOne = (): boolean => {
    const collections: Array<[
      keyof Omit<ProjectManifestV1["omissions"], "truncated">,
      unknown[]
    ]> = [
      ["topology", candidate.topology],
      ["dirtyFiles", candidate.git.dirtyFiles],
      ["scripts", candidate.scripts],
      ["configFiles", candidate.configFiles],
      ["ports", candidate.ports],
      ["workspacePatterns", candidate.project.workspacePatterns]
    ];
    for (const [omissionKey, collection] of collections) {
      if (collection.length > 0) {
        collection.pop();
        candidate.omissions[omissionKey] += 1;
        candidate.omissions.truncated = true;
        return true;
      }
    }
    return false;
  };

  while (byteSize(canonical) > MANIFEST_MAX_BYTES && removeOne()) {
    canonical = canonicalJson(candidate);
  }
  if (byteSize(canonical) > MANIFEST_MAX_BYTES) {
    throw new Error("The manifest core metadata exceeds the deterministic byte budget.");
  }
  return { manifest: candidate, canonical };
}

export class ManifestService {
  private readonly now: () => Date;
  private readonly timer: () => number;

  constructor(
    private readonly database: Database.Database,
    options: ManifestServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.timer = options.timer ?? (() => performance.now());
  }

  indexProject(projectRoot: string): ManifestSnapshot {
    const project = this.resolveProject(projectRoot);
    const startedAt = this.timer();
    const discovery = discoverProject(project.canonical_root);
    const safeFiles: string[] = [];
    let secretFiles = 0;
    let binaryFiles = 0;
    let oversizedFiles = 0;

    for (const projectPath of discovery.files) {
      if (isSecretShapedPath(projectPath)) {
        secretFiles += 1;
        continue;
      }
      if (isBinaryPath(projectPath)) {
        binaryFiles += 1;
        continue;
      }
      try {
        const stats = statSync(resolve(project.canonical_root, projectPath));
        if (!stats.isFile()) {
          continue;
        }
        if (stats.size > MAX_INDEXED_FILE_BYTES) {
          oversizedFiles += 1;
          continue;
        }
        safeFiles.push(projectPath);
      } catch {
        // Concurrent filesystem churn is omitted and picked up on the next reindex.
      }
    }

    const safeFileSet = new Set(safeFiles);
    const packageMetadata = parsePackageMetadata(project.canonical_root, safeFileSet);
    const configInputs: Array<{ path: string; content: string }> = [];
    const topology: ProjectManifestV1["topology"] = [];
    let sourceFileCount = 0;

    for (const projectPath of safeFiles) {
      if (isSourcePath(projectPath)) {
        sourceFileCount += 1;
      }
      if (!isConfigPath(projectPath) && !(isSourcePath(projectPath) && isJavaScriptFamily(projectPath))) {
        continue;
      }
      try {
        const content = readFileSync(resolve(project.canonical_root, projectPath), "utf8");
        if (isConfigPath(projectPath)) {
          configInputs.push({ path: projectPath, content });
        }
        if (isSourcePath(projectPath) && isJavaScriptFamily(projectPath)) {
          topology.push(parseSourceTopology(projectPath, content));
        }
      } catch {
        // Unreadable or concurrently removed files are safely omitted.
      }
    }

    const manifest: ProjectManifestV1 = {
      schemaVersion: 1,
      project: {
        name: packageMetadata.name ?? project.display_name ?? basename(project.canonical_root),
        packageManagers: packageMetadata.packageManagers,
        workspacePatterns: packageMetadata.workspacePatterns
      },
      frameworks: packageMetadata.frameworks,
      scripts: packageMetadata.scripts,
      ports: parsePorts(configInputs, packageMetadata.scriptCommands),
      configFiles: configInputs.map((config) => config.path).sort(),
      topology: topology.sort((left, right) => left.path.localeCompare(right.path)),
      git: {
        branch: discovery.branch,
        dirtyFiles: discovery.dirtyFiles.filter((path) => safeFileSet.has(path)).sort(),
        dirtyFileCount: discovery.dirtyFileCount
      },
      files: {
        discovered: discovery.files.length,
        source: sourceFileCount
      },
      exclusions: {
        secretFiles,
        binaryFiles,
        oversizedFiles,
        excludedDirectories: discovery.excludedDirectories
      },
      omissions: {
        truncated: false,
        topology: 0,
        dirtyFiles: 0,
        scripts: 0,
        ports: 0,
        configFiles: 0,
        workspacePatterns: 0
      }
    };

    const bounded = boundedManifest(manifest);
    const version = createHash("sha256").update(bounded.canonical).digest("hex");
    const bytes = byteSize(bounded.canonical);
    const generatedAt = this.now().toISOString();
    const durationMs = Math.max(0, this.timer() - startedAt);
    const snapshot: ManifestSnapshot = {
      projectId: project.id,
      version,
      canonicalJson: bounded.canonical,
      generatedAt,
      durationMs,
      byteSize: bytes,
      estimatedTokens: Math.ceil(bytes / 4),
      stale: false,
      manifest: bounded.manifest
    };
    saveManifestSnapshot(this.database, snapshot);
    return snapshot;
  }

  getLatest(projectRoot: string): ManifestSnapshot | undefined {
    return findLatestManifestSnapshot(this.database, this.resolveProject(projectRoot).id);
  }

  markStale(projectRoot: string): void {
    markLatestManifestStale(this.database, this.resolveProject(projectRoot).id);
  }

  metrics(snapshot: ManifestSnapshot): ManifestMetricsResult {
    return {
      ok: true,
      projectId: snapshot.projectId,
      version: snapshot.version,
      generatedAt: snapshot.generatedAt,
      durationMs: snapshot.durationMs,
      byteSize: snapshot.byteSize,
      estimatedTokens: snapshot.estimatedTokens,
      stale: false,
      truncated: snapshot.manifest.omissions.truncated
    };
  }

  private resolveProject(projectRoot: string): ProjectRow {
    const correlationId = randomUUID();
    let canonicalRoot: string;
    try {
      canonicalRoot = canonicalizeProjectRoot(projectRoot);
    } catch {
      throw new CoordinationError({
        code: "PROJECT_NOT_FOUND",
        message: "The project root is missing or unreadable.",
        correlationId
      });
    }
    const project = findProjectByRoot(this.database, canonicalRoot);
    if (!project) {
      throw new CoordinationError({
        code: "PROJECT_NOT_FOUND",
        message: "The project has not been initialized in Belay.",
        correlationId
      });
    }
    return project;
  }
}

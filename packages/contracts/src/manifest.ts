export interface ProjectManifestV1 {
  schemaVersion: 1;
  project: {
    name: string;
    packageManagers: string[];
    workspacePatterns: string[];
  };
  frameworks: string[];
  scripts: string[];
  ports: Array<{
    port: number;
    evidence: string;
  }>;
  configFiles: string[];
  topology: Array<{
    path: string;
    exports: Array<{ name: string; kind: string }>;
    imports: string[];
  }>;
  git: {
    branch: string | null;
    dirtyFiles: string[];
    dirtyFileCount: number;
  };
  files: {
    discovered: number;
    source: number;
  };
  exclusions: {
    secretFiles: number;
    binaryFiles: number;
    oversizedFiles: number;
    excludedDirectories: number;
  };
  omissions: {
    truncated: boolean;
    topology: number;
    dirtyFiles: number;
    scripts: number;
    ports: number;
    configFiles: number;
    workspacePatterns: number;
  };
}

export interface ManifestSnapshot {
  projectId: string;
  version: string;
  canonicalJson: string;
  generatedAt: string;
  durationMs: number;
  byteSize: number;
  estimatedTokens: number;
  stale: boolean;
  manifest: ProjectManifestV1;
}

export interface ManifestMetricsResult {
  ok: true;
  projectId: string;
  version: string;
  generatedAt: string;
  durationMs: number;
  byteSize: number;
  estimatedTokens: number;
  stale: false;
  truncated: boolean;
}


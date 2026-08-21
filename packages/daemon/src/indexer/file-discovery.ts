import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".belay",
  ".git",
  ".tools",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "vendor"
]);

function isExcludedDirectoryName(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_DIRECTORY_NAMES.has(lower) || lower.startsWith(".belay-");
}

const BINARY_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".class", ".dll", ".dylib", ".exe", ".gif", ".gz",
  ".ico", ".jar", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".o", ".obj", ".pdf",
  ".png", ".so", ".tar", ".ttf", ".wav", ".webm", ".webp", ".woff", ".woff2", ".zip"
]);

export interface DiscoveredProject {
  files: string[];
  branch: string | null;
  dirtyFiles: string[];
  dirtyFileCount: number;
  excludedDirectories: number;
}

function posixPath(value: string): string {
  return value.split(sep).join("/").replace(/^\.\//u, "");
}

function isInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function runGit(projectRoot: string, args: string[]): string | undefined {
  const result = spawnSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  return result.status === 0 ? result.stdout : undefined;
}

function gitRelativePath(projectRoot: string, rawPath: string): string | undefined {
  const normalizedRaw = rawPath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const fromProject = resolve(projectRoot, normalizedRaw);
  if (isInside(projectRoot, fromProject)) {
    return posixPath(relative(projectRoot, fromProject));
  }
  return undefined;
}

function readGitBranch(projectRoot: string): string | null {
  let current = projectRoot;
  while (true) {
    const gitMetadata = resolve(current, ".git");
    if (existsSync(gitMetadata)) {
      try {
        const head = lstatSync(gitMetadata).isDirectory()
          ? readFileSync(resolve(gitMetadata, "HEAD"), "utf8")
          : readFileSync(resolve(current, readFileSync(gitMetadata, "utf8").replace(/^gitdir:\s*/u, "").trim(), "HEAD"), "utf8");
        const reference = head.trim().match(/^ref:\s+refs\/heads\/(.+)$/u);
        return reference?.[1] ?? null;
      } catch {
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function walkFiles(projectRoot: string): { files: string[]; excludedDirectories: number } {
  const files: string[] = [];
  let excludedDirectories = 0;

  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      excludedDirectories += 1;
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && isExcludedDirectoryName(entry.name)) {
        excludedDirectories += 1;
        continue;
      }
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(posixPath(relative(projectRoot, absolutePath)));
      }
    }
  };

  visit(projectRoot);
  return { files: files.sort(), excludedDirectories };
}

function countExcludedDirectories(projectRoot: string): number {
  let count = 0;
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      count += 1;
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (isExcludedDirectoryName(entry.name)) {
        count += 1;
        continue;
      }
      visit(resolve(directory, entry.name));
    }
  };
  visit(projectRoot);
  return count;
}

export function isSecretShapedPath(projectPath: string): boolean {
  const lower = projectPath.toLowerCase().replaceAll("\\", "/");
  const basename = lower.slice(lower.lastIndexOf("/") + 1);
  if (basename === ".env.schema.json" || basename === ".env.example" || basename === ".env.sample") {
    return false;
  }
  if (basename === ".env" || basename.startsWith(".env.")) {
    return true;
  }
  if (/\.(?:key|pem|p12|pfx|vault)$/u.test(basename)) {
    return true;
  }
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/u.test(basename)) {
    return true;
  }
  return /^(?:credentials?|secrets?)(?:[._-].*)?\.(?:ini|json|toml|ya?ml)$/u.test(basename);
}

export function isBinaryPath(projectPath: string): boolean {
  const basename = projectPath.toLowerCase();
  const extensionIndex = basename.lastIndexOf(".");
  return extensionIndex >= 0 && BINARY_EXTENSIONS.has(basename.slice(extensionIndex));
}

export function discoverProject(projectRoot: string): DiscoveredProject {
  const canonicalRoot = realpathSync.native(projectRoot);
  if (!lstatSync(canonicalRoot).isDirectory()) {
    throw new Error("Project root is not a directory.");
  }

  const rawFiles = runGit(canonicalRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."]);
  if (rawFiles === undefined) {
    const fallback = walkFiles(canonicalRoot);
    return {
      files: fallback.files,
      branch: null,
      dirtyFiles: [],
      dirtyFileCount: 0,
      excludedDirectories: fallback.excludedDirectories
    };
  }

  const files = rawFiles
    .split("\0")
    .filter(Boolean)
    .map((path) => gitRelativePath(canonicalRoot, path))
    .filter((path): path is string => Boolean(path))
    .sort();

  const statusOutput = runGit(canonicalRoot, ["-c", "status.relativePaths=true", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  const dirtyFiles = (statusOutput ?? "")
    .split("\0")
    .filter((entry) => entry.length >= 4 && /^[ MADRCU?!]{2} /u.test(entry.slice(0, 3)))
    .map((entry) => gitRelativePath(canonicalRoot, entry.slice(3)))
    .filter((path): path is string => typeof path === "string")
    .filter((path) => !isSecretShapedPath(path))
    .sort();

  return {
    files,
    branch: readGitBranch(canonicalRoot),
    dirtyFiles: [...new Set(dirtyFiles)],
    dirtyFileCount: new Set(dirtyFiles).size,
    excludedDirectories: countExcludedDirectories(canonicalRoot)
  };
}

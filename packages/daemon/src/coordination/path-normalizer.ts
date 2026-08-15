import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { CoordinationError } from "./errors.js";

export interface NormalizedRepositoryPath {
  pathKey: string;
  displayPath: string;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function nearestExistingAncestor(candidate: string): string {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
  return current;
}

export function normalizeRepositoryPaths(
  canonicalRoot: string,
  inputPaths: string[],
  correlationId: string
): NormalizedRepositoryPath[] {
  const normalizedRoot = realpathSync.native(canonicalRoot);
  const unique = new Map<string, NormalizedRepositoryPath>();

  for (const originalPath of inputPaths) {
    if (originalPath.includes("\u0000") || isAbsolute(originalPath) || win32.isAbsolute(originalPath)) {
      throw new CoordinationError({
        code: "PATH_OUTSIDE_PROJECT",
        message: "File paths must be repository-relative.",
        correlationId
      });
    }

    const slashPath = originalPath.replaceAll("\\", "/");
    const normalized = slashPath
      .split("/")
      .reduce<string[]>((parts, component) => {
        if (component === "" || component === ".") {
          return parts;
        }
        if (component === "..") {
          if (parts.length === 0) {
            throw new CoordinationError({
              code: "PATH_OUTSIDE_PROJECT",
              message: "File path escapes the project root.",
              correlationId
            });
          }
          parts.pop();
          return parts;
        }
        parts.push(component);
        return parts;
      }, [])
      .join("/");

    if (normalized.length === 0) {
      throw new CoordinationError({
        code: "INVALID_INPUT",
        message: "File paths must identify a file within the project.",
        correlationId
      });
    }

    const absoluteCandidate = resolve(normalizedRoot, ...normalized.split("/"));
    const existingAncestor = realpathSync.native(nearestExistingAncestor(absoluteCandidate));
    if (!isWithinRoot(normalizedRoot, absoluteCandidate) || !isWithinRoot(normalizedRoot, existingAncestor)) {
      throw new CoordinationError({
        code: "PATH_OUTSIDE_PROJECT",
        message: "File path escapes the project root.",
        correlationId
      });
    }

    const pathKey = process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
    unique.set(pathKey, { pathKey, displayPath: normalized });
  }

  return [...unique.values()].sort((left, right) => left.pathKey.localeCompare(right.pathKey));
}


import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
  type Scanner
} from "typescript/unstable/ast";

export const MAX_INDEXED_FILE_BYTES = 256 * 1024;
const SOURCE_EXTENSIONS = new Set([".cjs", ".cpp", ".cts", ".h", ".hpp", ".js", ".jsx", ".mjs", ".mts", ".php", ".ts", ".tsx"]);
const CONFIG_NAMES = /^(?:docker-compose(?:\.[^.]+)?\.ya?ml|dockerfile|eslint\.config\.[^.]+|next\.config\.[^.]+|nuxt\.config\.[^.]+|phpunit\.xml|tsconfig(?:\.[^.]+)?\.json|vite\.config\.[^.]+|vitest\.config\.[^.]+)$/iu;
const FRAMEWORK_PACKAGES: Record<string, string> = {
  "@angular/core": "Angular",
  "@modelcontextprotocol/server": "MCP Server",
  "@nestjs/core": "NestJS",
  "@sveltejs/kit": "SvelteKit",
  "@vitejs/plugin-react": "Vite",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  laravel: "Laravel",
  next: "Next.js",
  nuxt: "Nuxt",
  react: "React",
  svelte: "Svelte",
  vite: "Vite",
  vue: "Vue"
};

export interface ParsedPackageMetadata {
  name: string | undefined;
  packageManagers: string[];
  workspacePatterns: string[];
  frameworks: string[];
  scripts: string[];
  scriptCommands: Array<{ name: string; command: string }>;
}

interface PackageJsonShape {
  name?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  workspaces?: unknown;
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function workspacePatterns(value: unknown): string[] {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { packages?: unknown }).packages
      : value;
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string").sort()
    : [];
}

export function isSourcePath(projectPath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(projectPath).toLowerCase());
}

export function isConfigPath(projectPath: string): boolean {
  return CONFIG_NAMES.test(basename(projectPath));
}

export function parsePackageMetadata(projectRoot: string, files: Set<string>): ParsedPackageMetadata {
  const packagePath = files.has("package.json") ? resolve(projectRoot, "package.json") : undefined;
  let packageJson: PackageJsonShape = {};
  if (packagePath) {
    try {
      packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJsonShape;
    } catch {
      packageJson = {};
    }
  }

  const scripts = stringRecord(packageJson.scripts);
  const dependencies = {
    ...stringRecord(packageJson.dependencies),
    ...stringRecord(packageJson.devDependencies),
    ...stringRecord(packageJson.peerDependencies)
  };
  const managers = new Set<string>();
  if (typeof packageJson.packageManager === "string") {
    managers.add(packageJson.packageManager.split("@")[0] ?? packageJson.packageManager);
  }
  if (files.has("package-lock.json")) managers.add("npm");
  if (files.has("pnpm-lock.yaml")) managers.add("pnpm");
  if (files.has("yarn.lock")) managers.add("yarn");
  if (files.has("bun.lock") || files.has("bun.lockb")) managers.add("bun");

  return {
    name: typeof packageJson.name === "string" ? packageJson.name : undefined,
    packageManagers: [...managers].sort(),
    workspacePatterns: workspacePatterns(packageJson.workspaces),
    frameworks: [
      ...new Set(
        Object.keys(dependencies)
          .map((name) => FRAMEWORK_PACKAGES[name])
          .filter((name): name is string => typeof name === "string")
      )
    ].sort(),
    scripts: Object.keys(scripts).sort(),
    scriptCommands: Object.entries(scripts).sort(([left], [right]) => left.localeCompare(right)).map(([name, command]) => ({ name, command }))
  };
}

export function parsePorts(
  configFiles: Array<{ path: string; content: string }>,
  scriptCommands: Array<{ name: string; command: string }>
): Array<{ port: number; evidence: string }> {
  const ports = new Map<string, { port: number; evidence: string }>();
  const addMatches = (content: string, evidence: string): void => {
    const patterns = [
      /(?:--port(?:=|\s+)|\bPORT\s*=\s*|\bport\s*[:=]\s*)(\d{2,5})\b/giu,
      /(?:localhost|127\.0\.0\.1):([1-9]\d{1,4})\b/gu
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const port = Number(match[1]);
        if (Number.isInteger(port) && port > 0 && port <= 65_535) {
          ports.set(`${port}:${evidence}`, { port, evidence });
        }
      }
    }
  };
  for (const script of scriptCommands) addMatches(script.command, `script:${script.name}`);
  for (const config of configFiles) addMatches(config.content, `config:${config.path}`);
  return [...ports.values()].sort((left, right) => left.port - right.port || left.evidence.localeCompare(right.evidence));
}

interface StaticToken {
  kind: SyntaxKind;
  text: string;
  depth: number;
}

function tokenizeSource(content: string, jsx: boolean): StaticToken[] {
  const scanner: Scanner = createScanner(true, jsx ? LanguageVariant.JSX : LanguageVariant.Standard, content);
  const tokens: StaticToken[] = [];
  let depth = 0;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.CloseBraceToken) depth = Math.max(0, depth - 1);
    tokens.push({
      kind,
      text: kind === SyntaxKind.Identifier || kind === SyntaxKind.StringLiteral
        ? scanner.getTokenValue()
        : scanner.getTokenText(),
      depth
    });
    if (kind === SyntaxKind.OpenBraceToken) depth += 1;
  }
  return tokens;
}

function declarationKind(kind: SyntaxKind): string | undefined {
  if (kind === SyntaxKind.FunctionKeyword) return "function";
  if (kind === SyntaxKind.ClassKeyword) return "class";
  if (kind === SyntaxKind.InterfaceKeyword) return "interface";
  if (kind === SyntaxKind.TypeKeyword) return "type";
  if (kind === SyntaxKind.EnumKeyword) return "enum";
  if (kind === SyntaxKind.ConstKeyword || kind === SyntaxKind.LetKeyword || kind === SyntaxKind.VarKeyword) return "variable";
  return undefined;
}

function moduleSpecifier(tokens: StaticToken[], start: number): string | undefined {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || (token.depth === 0 && token.kind === SyntaxKind.SemicolonToken)) break;
    if (token.kind === SyntaxKind.StringLiteral) return token.text;
  }
  return undefined;
}

export function parseSourceTopology(projectPath: string, content: string) {
  const tokens = tokenizeSource(content, projectPath.endsWith("x"));
  const exports: Array<{ name: string; kind: string }> = [];
  const imports: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.depth !== 0) continue;
    if (token.kind === SyntaxKind.ImportKeyword) {
      const imported = moduleSpecifier(tokens, index + 1);
      if (imported?.startsWith(".")) imports.push(imported);
      continue;
    }
    if (token.kind !== SyntaxKind.ExportKeyword) continue;

    const exportedModule = moduleSpecifier(tokens, index + 1);
    if (exportedModule?.startsWith(".")) imports.push(exportedModule);
    let declarationIndex = index + 1;
    if (tokens[declarationIndex]?.kind === SyntaxKind.DefaultKeyword) declarationIndex += 1;
    const declaration = tokens[declarationIndex];
    const kind = declaration ? declarationKind(declaration.kind) : undefined;
    if (kind) {
      const name = tokens.slice(declarationIndex + 1).find((candidate) => candidate.depth === 0 && candidate.kind === SyntaxKind.Identifier);
      if (name) exports.push({ name: name.text, kind });
      continue;
    }
    if (declaration?.kind === SyntaxKind.OpenBraceToken) {
      for (let cursor = declarationIndex + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (!candidate || candidate.kind === SyntaxKind.CloseBraceToken) break;
        if (candidate.kind === SyntaxKind.Identifier) exports.push({ name: candidate.text, kind: "re-export" });
      }
    } else if (declaration?.kind === SyntaxKind.AsteriskToken) {
      exports.push({ name: "*", kind: "re-export" });
    }
  }
  return {
    path: projectPath,
    exports: exports.sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind)),
    imports: [...new Set(imports)].sort()
  };
}

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CommandPolicyClass } from "@agentmesh/contracts";

export type CommandArgumentMode = "none" | "safe_tokens" | "repository_paths";

export interface CommandTemplate {
  id: string;
  executable: string;
  displayExecutable: string;
  fixedArguments: readonly string[];
  argumentMode: CommandArgumentMode;
  minimumArguments: number;
  maximumArguments: number;
  defaultWorkingDirectory: string;
  allowedWorkingDirectories: readonly string[];
  environmentProfile?: string;
  environmentVariableNames: readonly string[];
  inheritedEnvironmentVariableNames?: readonly string[];
  policyClass: CommandPolicyClass;
  targetAlias?: string;
  policyReason?: string;
  policyVersion?: string;
  approvalTtlMilliseconds?: number;
  timeoutMilliseconds: number;
  maxOutputBytes: number;
}

export interface ValidatedCommandPlan {
  template: CommandTemplate;
  arguments: string[];
  absoluteWorkingDirectory: string;
  displayWorkingDirectory: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]{1,512}$/u;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const COMMAND_ID = /^[a-z][a-z0-9._-]{0,79}$/u;

function posixPath(value: string): string {
  return value.split(sep).join("/");
}

function pathIsInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function normalizeRegisteredDirectory(value: string): string {
  const normalized = posixPath(value).replace(/^\.\//u, "").replace(/\/$/u, "");
  if (
    normalized === "" ||
    normalized === "." ||
    (!isAbsolute(value) && !normalized.split("/").includes(".."))
  ) {
    return normalized || ".";
  }
  throw new Error("Registered working directories must stay repository-relative.");
}

function validateTemplate(template: CommandTemplate): CommandTemplate {
  if (!COMMAND_ID.test(template.id)) throw new Error("Invalid registered command id.");
  if (!template.executable || /[\u0000\r\n]/u.test(template.executable)) {
    throw new Error("Invalid registered executable.");
  }
  if (!template.displayExecutable || /[\u0000-\u001F\u007F]/u.test(template.displayExecutable)) {
    throw new Error("Invalid registered executable display name.");
  }
  if (
    !Number.isInteger(template.minimumArguments) ||
    !Number.isInteger(template.maximumArguments) ||
    template.minimumArguments < 0 ||
    template.maximumArguments < template.minimumArguments ||
    template.maximumArguments > 64
  ) {
    throw new Error("Invalid registered argument bounds.");
  }
  if (
    !Number.isInteger(template.timeoutMilliseconds) ||
    template.timeoutMilliseconds < 100 ||
    template.timeoutMilliseconds > 15 * 60 * 1000
  ) {
    throw new Error("Invalid registered command timeout.");
  }
  if (
    !Number.isInteger(template.maxOutputBytes) ||
    template.maxOutputBytes < 256 ||
    template.maxOutputBytes > 4 * 1024 * 1024
  ) {
    throw new Error("Invalid registered output budget.");
  }
  if (template.policyClass === "approval_required") {
    if (!template.targetAlias || !template.policyReason) {
      throw new Error("Approval-required commands need a target alias and policy reason.");
    }
    const ttl = template.approvalTtlMilliseconds ?? 5 * 60 * 1000;
    if (!Number.isInteger(ttl) || ttl < 1_000 || ttl > 60 * 60 * 1000) {
      throw new Error("Invalid registered approval expiry.");
    }
  }
  if (template.fixedArguments.some((argument) => /[\u0000\r\n]/u.test(argument))) {
    throw new Error("Invalid registered fixed argument.");
  }
  if (template.environmentVariableNames.some((name) => !ENVIRONMENT_NAME.test(name))) {
    throw new Error("Invalid registered environment variable name.");
  }
  normalizeRegisteredDirectory(template.defaultWorkingDirectory);
  if (template.allowedWorkingDirectories.length === 0) {
    throw new Error("At least one working directory must be registered.");
  }
  template.allowedWorkingDirectories.forEach(normalizeRegisteredDirectory);
  return Object.freeze({
    ...template,
    fixedArguments: Object.freeze([...template.fixedArguments]),
    allowedWorkingDirectories: Object.freeze([...template.allowedWorkingDirectories]),
    environmentVariableNames: Object.freeze([...template.environmentVariableNames]),
    ...(template.inheritedEnvironmentVariableNames
      ? {
          inheritedEnvironmentVariableNames: Object.freeze([
            ...template.inheritedEnvironmentVariableNames
          ])
        }
      : {})
  });
}

export class CommandRegistry {
  private readonly templates = new Map<string, CommandTemplate>();

  constructor(templates: readonly CommandTemplate[]) {
    for (const candidate of templates) {
      const template = validateTemplate(candidate);
      if (this.templates.has(template.id)) {
        throw new Error(`Duplicate registered command: ${template.id}`);
      }
      this.templates.set(template.id, template);
    }
  }

  get(commandId: string): CommandTemplate | undefined {
    return this.templates.get(commandId);
  }

  list(): Array<Pick<CommandTemplate, "id" | "displayExecutable" | "policyClass">> {
    return [...this.templates.values()]
      .map(({ id, displayExecutable, policyClass }) => ({ id, displayExecutable, policyClass }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  validatePlan(
    template: CommandTemplate,
    projectRoot: string,
    requestedArguments: readonly string[],
    requestedWorkingDirectory?: string
  ): ValidatedCommandPlan {
    if (
      requestedArguments.length < template.minimumArguments ||
      requestedArguments.length > template.maximumArguments
    ) {
      throw new Error("The command arguments do not match the registered template.");
    }
    const argumentsForSpawn = this.validateArguments(
      template.argumentMode,
      projectRoot,
      requestedArguments
    );
    const requested = requestedWorkingDirectory || template.defaultWorkingDirectory;
    if (isAbsolute(requested) || /\u0000/u.test(requested)) {
      throw new Error("The working directory must stay inside the repository.");
    }
    const lexicalDirectory = resolve(projectRoot, requested);
    if (!pathIsInside(projectRoot, lexicalDirectory) || !existsSync(lexicalDirectory)) {
      throw new Error("The working directory must stay inside the repository.");
    }
    const absoluteWorkingDirectory = realpathSync.native(lexicalDirectory);
    if (!pathIsInside(projectRoot, absoluteWorkingDirectory)) {
      throw new Error("The working directory must stay inside the repository.");
    }
    const displayWorkingDirectory = posixPath(relative(projectRoot, absoluteWorkingDirectory)) || ".";
    const allowed = template.allowedWorkingDirectories
      .map(normalizeRegisteredDirectory)
      .some(
        (directory) =>
          (directory === "." && displayWorkingDirectory === ".") ||
          (directory !== "." &&
            (displayWorkingDirectory === directory ||
              displayWorkingDirectory.startsWith(`${directory}/`)))
      );
    if (!allowed) {
      throw new Error("The working directory is not allowed for this command.");
    }
    return {
      template,
      arguments: argumentsForSpawn,
      absoluteWorkingDirectory,
      displayWorkingDirectory
    };
  }

  private validateArguments(
    mode: CommandArgumentMode,
    projectRoot: string,
    requestedArguments: readonly string[]
  ): string[] {
    if (mode === "none") {
      if (requestedArguments.length > 0) {
        throw new Error("This command does not accept arguments.");
      }
      return [];
    }
    if (mode === "safe_tokens") {
      if (
        requestedArguments.some(
          (argument) =>
            !SAFE_TOKEN.test(argument) ||
            /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(argument) ||
            /[;&|<>`$()"'\r\n\u0000]/u.test(argument)
        )
      ) {
        throw new Error("A command argument violates the registered token policy.");
      }
      return [...requestedArguments];
    }

    return requestedArguments.map((argument) => {
      if (isAbsolute(argument) || /\u0000/u.test(argument)) {
        throw new Error("A repository-path argument escapes the project.");
      }
      const lexicalPath = resolve(projectRoot, argument);
      if (!pathIsInside(projectRoot, lexicalPath)) {
        throw new Error("A repository-path argument escapes the project.");
      }
      const canonicalPath = existsSync(lexicalPath) ? realpathSync.native(lexicalPath) : lexicalPath;
      if (!pathIsInside(projectRoot, canonicalPath)) {
        throw new Error("A repository-path argument escapes the project.");
      }
      return posixPath(relative(projectRoot, canonicalPath));
    });
  }
}

export function defaultCommandTemplates(): CommandTemplate[] {
  return [
    {
      id: "node-version",
      executable: process.execPath,
      displayExecutable: "node",
      fixedArguments: ["--version"],
      argumentMode: "none",
      minimumArguments: 0,
      maximumArguments: 0,
      defaultWorkingDirectory: ".",
      allowedWorkingDirectories: ["."],
      environmentVariableNames: [],
      inheritedEnvironmentVariableNames: [],
      policyClass: "auto_allow",
      timeoutMilliseconds: 5_000,
      maxOutputBytes: 4_096
    },
    {
      id: "demo-staging-reload",
      executable: process.execPath,
      displayExecutable: "node",
      fixedArguments: [
        "-e",
        "process.stdout.write('Simulated staging reload completed.\\n')"
      ],
      argumentMode: "none",
      minimumArguments: 0,
      maximumArguments: 0,
      defaultWorkingDirectory: ".",
      allowedWorkingDirectories: ["."],
      environmentVariableNames: [],
      inheritedEnvironmentVariableNames: [],
      policyClass: "approval_required",
      targetAlias: "demo-staging",
      policyReason: "Reloading staging changes a protected runtime.",
      policyVersion: "local-policy-v1",
      approvalTtlMilliseconds: 5 * 60 * 1000,
      timeoutMilliseconds: 5_000,
      maxOutputBytes: 4_096
    }
  ];
}

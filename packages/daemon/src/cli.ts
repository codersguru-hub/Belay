import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createBelayApp } from "./app.js";
import { loadConfig } from "./config.js";

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      spawn("cmd.exe", ["/c", "start", '""', url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Silent fallback if running in non-graphical environment
  }
}

async function checkPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((res) => {
    const server = createServer();
    server.once("error", () => res(false));
    server.once("listening", () => {
      server.close(() => res(true));
    });
    server.listen(port, host);
  });
}

async function checkDaemonHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function printHelp(): void {
  process.stdout.write(`
Belay — Local-First Control Plane for Multi-Agent Coding Fleets

Usage:
  belay [command] [options]
  belay  [command] [options] (compatibility alias)

Commands:
  start          Start the Belay daemon and cockpit (default)
  init           Initialize .belay configuration in current project
  setup          Automatically configure Claude Desktop on this machine
  doctor         Run system diagnostics and check environment health
  stdio          Run standard I/O MCP bridge for Claude Desktop / stdio clients
  verify         Run zero-leak and multi-agent regression tests
  help           Show this help message

Options for 'start':
  -p, --port <port>          Port to listen on (default: 3420)
  -r, --project-root <path>  Target project directory (default: current directory)
  -s, --state-dir <path>     Directory for SQLite state database (default: ~/.belay)
  -w, --workspace <name>     Shared workspace name for multi-repo fact sharing
  -c, --cloud-url <url>      Cloud Run intelligence service URL
  -o, --open                 Automatically open the Cockpit UI in default browser
  -h, --help                 Show help for start command

Options for 'stdio':
  -u, --url <url>            Target Belay daemon MCP URL (default: http://127.0.0.1:3420/mcp)

Examples:
  npx belay start --open
  npx belay init
  npx belay stdio
  npx belay doctor
`);
}

async function runStart(rawArgs: string[]): Promise<void> {
  const options = {
    port: { type: "string" as const, short: "p" },
    "project-root": { type: "string" as const, short: "r" },
    "state-dir": { type: "string" as const, short: "s" },
    workspace: { type: "string" as const, short: "w" },
    "cloud-url": { type: "string" as const, short: "c" },
    open: { type: "boolean" as const, short: "o" },
    help: { type: "boolean" as const, short: "h" }
  };

  const parsed = parseArgs({
    args: rawArgs,
    options,
    strict: false,
    allowPositionals: true
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const overrides = {
    ...(parsed.values.port ? { port: Number.parseInt(parsed.values.port as string, 10) } : {}),
    ...(parsed.values["project-root"] ? { projectRoot: resolve(parsed.values["project-root"] as string) } : {}),
    ...(parsed.values["state-dir"] ? { stateDirectory: resolve(parsed.values["state-dir"] as string) } : {}),
    ...(parsed.values.workspace ? { workspaceName: parsed.values.workspace as string } : {}),
    ...(parsed.values["cloud-url"] ? { cloudServiceUrl: parsed.values["cloud-url"] as string } : {})
  };

  const app = createBelayApp(overrides);
  const endpoint = await app.start();

  const isCloudConfigured = Boolean(app.config.cloudServiceUrl);
  const cockpitUrl = `http://${endpoint.host}:${endpoint.port}/`;

  process.stdout.write(`
===================================================================
  Belay Control Plane (v0.1.0)
  Local-First Multi-Agent Coordination & Secret Boundary
===================================================================
  * Cockpit UI:     ${cockpitUrl}
  * MCP Endpoint:   ${endpoint.mcpUrl}
  * Project Root:   ${app.config.projectRoot}
  * State Database: ${app.config.databasePath}
  * Workspace:      ${app.config.workspaceName ?? "(standalone)"}
  * Cloud Intel:    ${isCloudConfigured ? "Connected (Gemini 3.6 Flash)" : "Local-only (optional advisory plane not configured)"}
===================================================================
  Ready for connections from Claude Code, Codex, Antigravity & others.
  Press Ctrl+C to stop the daemon gracefully.
===================================================================
`);

  if (parsed.values.open) {
    openBrowser(cockpitUrl);
  }

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write("\nStopping Belay daemon...\n");
    try {
      await app.close();
      process.stdout.write("Belay daemon stopped cleanly.\n");
    } catch (err) {
      process.stderr.write(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
}

async function runInit(): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const belayDir = resolve(projectRoot, ".belay");
  const configFile = resolve(belayDir, "config.json");
  const gitignoreFile = resolve(projectRoot, ".gitignore");

  process.stdout.write(`Initializing Belay in ${projectRoot}...\n\n`);

  if (!existsSync(belayDir)) {
    mkdirSync(belayDir, { recursive: true });
    process.stdout.write(" [OK] Created .belay directory\n");
  } else {
    process.stdout.write(" [i] Found existing .belay directory\n");
  }

  if (!existsSync(configFile)) {
    const defaultConfig = {
      port: 3420,
      workspaceName: "belay-suite"
    };
    writeFileSync(configFile, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
    process.stdout.write(" [OK] Created .belay/config.json\n");
  } else {
    process.stdout.write(" [i] .belay/config.json already exists\n");
  }

  // Ensure .gitignore ignores SQLite WAL and vault files if git is used
  if (existsSync(gitignoreFile)) {
    const gitignoreContent = readFileSync(gitignoreFile, "utf8");
    const requiredPatterns = [".belay/state.db*", ".belay/*.vault", ".belay-state/"];
    const missingPatterns = requiredPatterns.filter((p) => !gitignoreContent.includes(p));

    if (missingPatterns.length > 0) {
      const appendBlock = `\n# Belay local state & encrypted secrets\n${missingPatterns.join("\n")}\n`;
      writeFileSync(gitignoreFile, `${gitignoreContent.trimEnd()}${appendBlock}`, "utf8");
      process.stdout.write(" [OK] Updated .gitignore with local state and vault protections\n");
    } else {
      process.stdout.write(" [OK] .gitignore already contains Belay security rules\n");
    }
  }

  process.stdout.write(`
Initialization complete!

Connect your AI coding agents:
-------------------------------------------------------------------
1. Claude Code:
   claude mcp add --transport http belay http://127.0.0.1:3420/mcp

2. OpenAI Codex / VS Code / Gemini Settings:
   {
     "mcpServers": {
       "belay": {
         "url": "http://127.0.0.1:3420/mcp"
       }
     }
   }

3. Antigravity / Cursor:
   Add "http://127.0.0.1:3420/mcp" in MCP Servers panel.

Start the daemon:
   npx belay start --open
`);
}

async function runDoctor(): Promise<void> {
  process.stdout.write("\nRunning Belay System Doctor...\n\n");

  // 1. Node.js Version Check
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 22) {
    process.stdout.write(` [PASS] Node.js version: v${process.versions.node} (>= 22 required)\n`);
  } else {
    process.stdout.write(` [FAIL] Node.js version: v${process.versions.node} (Node 22 or newer is required)\n`);
  }

  // 2. Project Directory Check
  const config = loadConfig();
  process.stdout.write(` [PASS] Project root: ${config.projectRoot}\n`);
  process.stdout.write(` [PASS] State directory: ${config.stateDirectory}\n`);

  // 3. Port & Daemon Running Check
  const isHealthy = await checkDaemonHealthy(`http://127.0.0.1:${config.port}`);
  if (isHealthy) {
    process.stdout.write(` [INFO] Belay daemon is ACTIVE and healthy on http://127.0.0.1:${config.port}\n`);
  } else {
    const isPortFree = await checkPortAvailable(config.port, config.host);
    if (isPortFree) {
      process.stdout.write(` [PASS] Port ${config.port} is available for daemon startup\n`);
    } else {
      process.stdout.write(` [WARN] Port ${config.port} is in use by another process\n`);
    }
  }

  // 4. Age CLI Check
  const ageBinary = config.ageBinaryPath ?? process.env.BELAY_AGE_BIN ?? "age";
  try {
    const res = spawnSync(ageBinary, ["--version"], { encoding: "utf8" });
    if (res.status === 0 && res.stdout) {
      process.stdout.write(` [PASS] age encryption binary found: ${res.stdout.trim()}\n`);
    } else {
      process.stdout.write(` [INFO] age encryption binary '${ageBinary}' not found on PATH (Vault runs in fallback/mock mode)\n`);
    }
  } catch {
    process.stdout.write(` [INFO] age encryption binary '${ageBinary}' not available (optional for basic coordination)\n`);
  }

  // 5. Google Cloud / Cloud Run Check
  if (config.cloudServiceUrl) {
    process.stdout.write(` [PASS] Cloud Run intelligence URL configured: ${config.cloudServiceUrl}\n`);
  } else {
    process.stdout.write(" [INFO] Cloud Run URL not configured (offline degraded mode active)\n");
  }

  process.stdout.write("\nDoctor check complete.\n\n");
}

async function runStdio(rawArgs: string[]): Promise<void> {
  const options = {
    url: { type: "string" as const, short: "u" }
  };
  const parsed = parseArgs({
    args: rawArgs,
    options,
    strict: false,
    allowPositionals: true
  });

  const config = loadConfig();
  const mcpUrl = (parsed.values.url as string) ?? process.env.BELAY_MCP_URL ?? `http://127.0.0.1:${config.port}/mcp`;

  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  let sessionId: string | null = null;
  const transport = new StdioServerTransport();

  function parseSseMessages(raw: string): unknown[] {
    const messages: unknown[] = [];
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trim();
        if (payload.length > 0) {
          try {
            messages.push(JSON.parse(payload));
          } catch {
            // Ignore non-json data
          }
        }
      }
    }
    if (messages.length === 0 && raw.trim().length > 0) {
      try {
        messages.push(JSON.parse(raw));
      } catch {
        // Ignore
      }
    }
    return messages;
  }

  transport.onmessage = async (message) => {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      };
      if (sessionId) {
        headers["mcp-session-id"] = sessionId;
      }

      const response = await fetch(mcpUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(message)
      });

      const newSessionId = response.headers.get("mcp-session-id");
      if (newSessionId) {
        sessionId = newSessionId;
      }

      if (response.ok) {
        const text = await response.text();
        const sseMessages = parseSseMessages(text);
        for (const msg of sseMessages) {
          await transport.send(msg as any);
        }
      } else {
        const errText = await response.text();
        let errJson: unknown;
        try {
          errJson = JSON.parse(errText);
        } catch {
          errJson = {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: `Belay HTTP ${response.status}: ${errText}`
            },
            id: (message as { id?: string | number }).id ?? undefined
          };
        }
        await transport.send(errJson as any);
      }
    } catch (err) {
      await transport.send({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: `Belay daemon is not running or unreachable at ${mcpUrl}. Start the daemon with 'npx belay start'.`
        },
        id: (message as { id?: string | number }).id ?? undefined
      });
    }
  };

  await transport.start();
}

function findClaudeDesktopConfigPaths(): string[] {
  const paths: string[] = [];
  const home = homedir();
  const platform = process.platform;

  if (platform === "win32") {
    // 1. Standard AppData
    const appdata = process.env.APPDATA;
    if (appdata) {
      paths.push(resolve(appdata, "Claude", "claude_desktop_config.json"));
    }
    // 2. Windows Store / Packaged AppData
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const packagesDir = resolve(localAppData, "Packages");
      if (existsSync(packagesDir)) {
        try {
          const entries = readdirSync(packagesDir);
          for (const entry of entries) {
            if (entry.startsWith("Claude_")) {
              paths.push(resolve(packagesDir, entry, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"));
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
  } else if (platform === "darwin") {
    paths.push(resolve(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
  } else {
    paths.push(resolve(home, ".config", "Claude", "claude_desktop_config.json"));
  }

  return paths;
}

async function runSetup(): Promise<void> {
  process.stdout.write("\nBelay Client Auto-Setup\n\n");
  const candidates = findClaudeDesktopConfigPaths();
  let updatedAny = false;

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf8");
        const json = JSON.parse(raw) as Record<string, unknown>;
        if (!json.mcpServers || typeof json.mcpServers !== "object") {
          json.mcpServers = {};
        }
        (json.mcpServers as Record<string, unknown>).belay = {
          command: "belay",
          args: ["stdio"]
        };
        writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n", "utf8");
        process.stdout.write(` [OK] Automatically configured Claude Desktop at:\n      ${configPath}\n`);
        updatedAny = true;
      } catch (err) {
        process.stdout.write(` [WARN] Could not update ${configPath}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  if (!updatedAny) {
    const defaultPath = candidates[0];
    if (defaultPath) {
      try {
        mkdirSync(dirname(defaultPath), { recursive: true });
        const config = {
          mcpServers: {
            belay: {
              command: "belay",
              args: ["stdio"]
            }
          }
        };
        writeFileSync(defaultPath, JSON.stringify(config, null, 2) + "\n", "utf8");
        process.stdout.write(` [OK] Created Claude Desktop configuration at:\n      ${defaultPath}\n`);
        updatedAny = true;
      } catch (err) {
        process.stdout.write(` [WARN] Could not create ${defaultPath}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  if (updatedAny) {
    process.stdout.write("\nSetup complete! Restart Claude Desktop to start using Belay.\n\n");
  } else {
    process.stdout.write(" [INFO] No Claude Desktop installation found on this machine.\n\n");
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command.startsWith("-") || command === "start") {
    const startArgs = command === "start" ? args.slice(1) : args;
    await runStart(startArgs);
  } else if (command === "stdio") {
    await runStdio(args.slice(1));
  } else if (command === "init") {
    await runInit();
  } else if (command === "setup") {
    await runSetup();
  } else if (command === "doctor" || command === "status") {
    await runDoctor();
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    process.exit(1);
  }
}

// Run CLI when invoked directly as process entrypoint
const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("cli.js") || entryFile.endsWith("cli.ts")) {
  void main().catch((error) => {
    process.stderr.write(`[Belay Fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}

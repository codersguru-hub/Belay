import type Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type {
  CreateStudioSessionInput,
  StudioAgentTarget,
  StudioDiffHunk,
  StudioDiffPayload,
  StudioMessage,
  StudioPromptInput,
  StudioSession
} from "@belay/contracts";
import type { CommandExecutor } from "../executor/command-executor.js";
import type { ApprovalService } from "../approval/approval-service.js";
import type { ApprovalEventHub } from "../approval/event-hub.js";

const AGENT_COMMAND_IDS: Record<StudioAgentTarget, string> = {
  antigravity: "antigravity-dispatch",
  codex: "codex-dispatch",
  claude: "claude-dispatch",
  // Multi-agent orchestration isn't implemented yet; falls back to the harmless echo stub.
  team: "agent-dispatch"
};

// Each agent dispatches to exactly one fixed CLI (see command-registry.ts) — there is no
// independent "model" a caller can select underneath it, so the displayed label describes what
// actually runs rather than a hardcoded, agent-independent default.
const AGENT_DISPLAY_LABEL: Record<StudioAgentTarget, string> = {
  claude: "Claude Code CLI",
  codex: "OpenAI Codex CLI",
  antigravity: "Antigravity (local IDE)",
  team: "Team orchestration (stub)"
};

type MessageListener = (sessionId: string, message: StudioMessage) => void;

interface SessionRow {
  id: string;
  project_id: string;
  title: string;
  active_agent: "antigravity" | "codex" | "claude" | "team";
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent_name: string | null;
  model: string | null;
  diffs_json: string | null;
  approval_id: string | null;
  created_at: string;
}

export class StudioService {
  private readonly messageListeners = new Set<MessageListener>();
  // Tracks approval requests created by dispatchPrompt so the eventual decision (approve,
  // reject, expire) can be folded back into the conversation as a follow-up assistant message.
  private readonly pendingDispatches = new Map<
    string,
    { sessionId: string; agentName: StudioAgentTarget; model: string }
  >();

  constructor(
    private readonly database: Database.Database,
    private readonly projectRoot: string,
    private readonly executor: CommandExecutor,
    private readonly approvals: ApprovalService,
    approvalEvents: ApprovalEventHub,
    private readonly now: () => Date = () => new Date()
  ) {
    approvals.onCommandExecuted((approvalId, result) => {
      const pending = this.pendingDispatches.get(approvalId);
      if (!pending) return;
      this.pendingDispatches.delete(approvalId);
      const body = result.status === "succeeded"
        ? (result.stdout.trim() || "(the command produced no output)")
        : `Execution ended with status "${result.status}"${result.stderr ? `:\n\n${result.stderr.trim()}` : "."}`;
      this.appendFollowUp(
        pending.sessionId,
        `### [${pending.agentName.toUpperCase()}] ${result.status === "succeeded" ? "Completed" : "Failed"}\n\n${body}`,
        pending.agentName,
        pending.model
      );
    });

    approvalEvents.subscribe((event) => {
      const pending = this.pendingDispatches.get(event.approvalId);
      if (!pending) return;
      if (event.status !== "rejected" && event.status !== "expired") return;
      this.pendingDispatches.delete(event.approvalId);
      const verb = event.status === "rejected" ? "Rejected" : "Expired";
      this.appendFollowUp(
        pending.sessionId,
        `### [${pending.agentName.toUpperCase()}] ${verb}\n\nThe dispatch was ${event.status} before it ran.`,
        pending.agentName,
        pending.model
      );
    });
  }

  /** Subscribe to messages appended after the initial dispatchPrompt response (e.g. once a
   * pending approval is later decided). Returns an unsubscribe function. */
  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private appendFollowUp(
    sessionId: string,
    content: string,
    agentName: StudioAgentTarget,
    model: string
  ): void {
    const timestamp = this.now().toISOString();
    const id = `msg-${randomUUID()}`;
    const diffs = this.getDiff();
    const diffsJson = diffs.length > 0 ? JSON.stringify(diffs) : null;
    this.database
      .prepare(
        "INSERT INTO studio_messages (id, session_id, role, content, agent_name, model, diffs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, sessionId, "assistant", content, agentName, model, diffsJson, timestamp);
    this.database
      .prepare("UPDATE studio_sessions SET updated_at = ? WHERE id = ?")
      .run(timestamp, sessionId);
    const message: StudioMessage = {
      id,
      sessionId,
      role: "assistant",
      content,
      agentName,
      model,
      diffs: diffs.length > 0 ? diffs : undefined,
      createdAt: timestamp
    };
    for (const listener of this.messageListeners) listener(sessionId, message);
  }

  listSessions(projectId: string): StudioSession[] {
    const rows = this.database
      .prepare(
        "SELECT id, project_id, title, active_agent, created_at, updated_at FROM studio_sessions WHERE project_id = ? ORDER BY updated_at DESC"
      )
      .all(projectId) as SessionRow[];

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id as any,
      title: row.title,
      activeAgent: row.active_agent,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  createSession(input: CreateStudioSessionInput): StudioSession {
    const id = `session-${randomBytes(6).toString("hex")}`;
    const timestamp = this.now().toISOString();

    this.database
      .prepare(
        "INSERT INTO studio_sessions (id, project_id, title, active_agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, input.projectId, input.title, input.activeAgent, timestamp, timestamp);

    return {
      id,
      projectId: input.projectId,
      title: input.title,
      activeAgent: input.activeAgent,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  getSession(sessionId: string): { session: StudioSession; messages: StudioMessage[] } | null {
    const sessionRow = this.database
      .prepare(
        "SELECT id, project_id, title, active_agent, created_at, updated_at FROM studio_sessions WHERE id = ?"
      )
      .get(sessionId) as SessionRow | undefined;

    if (!sessionRow) return null;

    const messageRows = this.database
      .prepare(
        "SELECT id, session_id, role, content, agent_name, model, diffs_json, approval_id, created_at FROM studio_messages WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId) as MessageRow[];

    const messages: StudioMessage[] = messageRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      agentName: row.agent_name ?? undefined,
      model: row.model ?? undefined,
      diffs: row.diffs_json ? (JSON.parse(row.diffs_json) as StudioDiffPayload[]) : undefined,
      approvalId: row.approval_id ?? undefined,
      createdAt: row.created_at
    }));

    return {
      session: {
        id: sessionRow.id,
        projectId: sessionRow.project_id as any,
        title: sessionRow.title,
        activeAgent: sessionRow.active_agent,
        createdAt: sessionRow.created_at,
        updatedAt: sessionRow.updated_at
      },
      messages
    };
  }

  getDiff(): StudioDiffPayload[] {
    if (!existsSync(this.projectRoot)) return [];

    try {
      const gitDiff = spawnSync("git", ["-C", this.projectRoot, "diff", "HEAD"], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true
      });

      if (gitDiff.error || gitDiff.status !== 0) {
        return [];
      }

      return parseGitDiff(gitDiff.stdout ?? "");
    } catch {
      return [];
    }
  }

  async dispatchPrompt(
    sessionId: string,
    input: StudioPromptInput
  ): Promise<{ userMessage: StudioMessage; assistantMessage: StudioMessage }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const timestamp = this.now().toISOString();

    // 1. Insert User Message
    const userMsgId = `msg-${randomUUID()}`;
    this.database
      .prepare(
        "INSERT INTO studio_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(userMsgId, sessionId, "user", input.prompt, timestamp);

    const userMessage: StudioMessage = {
      id: userMsgId,
      sessionId,
      role: "user",
      content: input.prompt,
      createdAt: timestamp
    };

    // 2. Dispatch to executor
    const agentName = input.targetAgent.toUpperCase();
    const modelName = input.model ?? AGENT_DISPLAY_LABEL[input.targetAgent];
    const commandId = AGENT_COMMAND_IDS[input.targetAgent];
    const contextNote = input.contextAttachments?.length
      ? `\n\n---\nContext attachments:\n${input.contextAttachments.map((a) => `- ${a}`).join("\n")}`
      : "";

    let assistantContent: string;
    let approvalId: string | undefined;
    let diffsForMessage: StudioDiffPayload[] = [];

    try {
      if (input.targetAgent === "antigravity") {
        // Antigravity is the local IDE host running this workbench, not a headless VPS worker —
        // there is no antigravity binary to dispatch to. Rejected here, at the single funnel every
        // caller goes through (REST, and any future MCP/CLI caller), rather than relying on the
        // Studio UI alone to keep this choice from ever reaching the executor.
        assistantContent = `### [${agentName}] Not Available\n\nAntigravity is the local IDE host, not a remote-dispatchable worker on this VPS. Select Claude Code or OpenAI Codex to dispatch a live agent, or Team for orchestration.`;
      } else if (input.targetAgent === "team") {
        // No real multi-agent orchestrator yet: run the harmless echo stub inline, same as before.
        const execResult = await this.executor.runWithStdin(
          { projectRoot: this.projectRoot, commandId, arguments: [] },
          JSON.stringify({ agent: input.targetAgent, prompt: input.prompt, contextAttachments: input.contextAttachments })
        );
        assistantContent = execResult.ok
          ? `### [${agentName}] Status\n\nTeam orchestration is not implemented yet. Received ${execResult.stdout.trim() || "no"} bytes; no agent was actually run.`
          : `### [${agentName}] Failed\n\nThe placeholder dispatch did not complete.`;
      } else {
        const result = await this.approvals.request(
          {
            projectRoot: this.projectRoot,
            commandId,
            arguments: [],
            requester: "studio-ui"
          },
          `${input.prompt}${contextNote}`
        );
        if (result.status === "pending") {
          approvalId = result.approvalId;
          this.pendingDispatches.set(result.approvalId, {
            sessionId,
            agentName: input.targetAgent,
            model: modelName
          });
          const expires = new Date(result.expiresAt).toLocaleTimeString();
          assistantContent = `### [${agentName}] Awaiting Approval\n\n${result.policyReason}\n\nApprove or reject this dispatch to let it run. This request expires at ${expires}.`;
        } else {
          // Reached only if the command's policy is reclassified to auto_allow/deny later.
          assistantContent = result.status === "succeeded"
            ? `### [${agentName}] Completed\n\n${result.stdout.trim() || "(no output)"}`
            : `### [${agentName}] Failed\n\nStatus: ${result.status}`;
          diffsForMessage = this.getDiff();
        }
      }
    } catch (err: any) {
      assistantContent = `### [${agentName}] Failed\n\n${err?.message ?? "Dispatch could not be submitted."}`;
    }

    const assistantTimestamp = this.now().toISOString();
    const assistantMsgId = `msg-${randomUUID()}`;
    const diffsJson = diffsForMessage.length > 0 ? JSON.stringify(diffsForMessage) : null;

    // 3. Insert Assistant Message
    this.database
      .prepare(
        "INSERT INTO studio_messages (id, session_id, role, content, agent_name, model, diffs_json, approval_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        assistantMsgId,
        sessionId,
        "assistant",
        assistantContent,
        input.targetAgent,
        modelName,
        diffsJson,
        approvalId ?? null,
        assistantTimestamp
      );

    // 4. Update session timestamp
    this.database
      .prepare("UPDATE studio_sessions SET updated_at = ? WHERE id = ?")
      .run(assistantTimestamp, sessionId);

    const assistantMessage: StudioMessage = {
      id: assistantMsgId,
      sessionId,
      role: "assistant",
      content: assistantContent,
      agentName: input.targetAgent,
      model: modelName,
      diffs: diffsForMessage.length > 0 ? diffsForMessage : undefined,
      approvalId,
      createdAt: assistantTimestamp
    };

    return { userMessage, assistantMessage };
  }
}

function parseGitDiff(diffText: string): StudioDiffPayload[] {
  if (!diffText.trim()) return [];

  const files: StudioDiffPayload[] = [];
  const fileChunks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split("\n");
    const header = lines[0] ?? "";
    const match = header.match(/a\/(.*?)\s+b\/(.*)/);
    const filePath = match ? (match[2] ?? match[1] ?? "file") : "unknown";

    let additions = 0;
    let deletions = 0;
    const hunks: StudioDiffHunk[] = [];
    let currentHunk: StudioDiffHunk | null = null;

    for (const line of lines.slice(1)) {
      if (line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/);
        if (hunkMatch) {
          if (currentHunk) hunks.push(currentHunk);
          currentHunk = {
            oldStart: parseInt(hunkMatch[1] ?? "1", 10),
            oldLines: parseInt(hunkMatch[2] ?? "1", 10),
            newStart: parseInt(hunkMatch[3] ?? "1", 10),
            newLines: parseInt(hunkMatch[4] ?? "1", 10),
            content: line + "\n"
          };
        }
      } else if (currentHunk) {
        currentHunk.content += line + "\n";
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    files.push({
      filePath,
      additions,
      deletions,
      status: "modified",
      hunks
    });
  }

  return files;
}

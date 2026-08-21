// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../packages/dashboard/src/App";
import type { DashboardSnapshot } from "../packages/dashboard/src/types";

class MockWebSocket {
  static readonly OPEN = 1;
  readonly readyState = MockWebSocket.OPEN;
  constructor(_url: string) {}
  addEventListener(_name: string, _listener: EventListenerOrEventListenerObject, _options?: unknown) {}
  close() {}
}

const snapshot: DashboardSnapshot = {
  generatedAt: "2026-08-15T10:00:00.000Z",
  service: {
    status: "online",
    cloudIntelligence: "degraded",
    cloudMessage: "Cloud intelligence unavailable · Local controls active",
    mcpSessions: 2
  },
  project: { id: "project-demo", name: "belay-demo", root: "D:/demo" },
  agents: [
    { name: "codex", activeTasks: 1, state: "active" },
    { name: "claude-code", activeTasks: 0, state: "idle" }
  ],
  summary: {
    activeTasks: 1,
    lockedFiles: 1,
    pendingApprovals: 1,
    checklistPending: 0,
    checklistBlocked: 0,
    checklistCompleted: 0,
    knowledgeFacts: 1
  },
  tasks: [{
    id: "task-refactor",
    title: "Refactor API",
    agentName: "codex",
    leaseExpiresAt: "2099-08-15T10:10:00.000Z",
    lockedFiles: ["src/engine/core.ts"],
    omittedLockedFiles: 0,
    checklistItemId: "check-refactor"
  }],
  checklist: [{
    id: "check-refactor",
    stageId: "stage-demo",
    title: "Refactor the shared API",
    description: "Keep all agents aligned on the contract migration.",
    status: "in_progress",
    ownerAgent: "codex",
    linkedTaskId: "task-refactor",
    dependencyIds: [],
    acceptanceCriteria: ["All clients compile"],
    priority: 80,
    progressSummary: "Contracts updated",
    progressPercent: 60,
    blockedReason: null,
    verificationEvidence: [],
    proposedBy: "claude-code",
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    completedAt: null
  }],
  knowledge: {
    workspaceId: "workspace-demo",
    omittedItems: 0,
    items: [{
      id: "knowledge-contracts",
      scope: "project",
      kind: "constraint",
      title: "Keep contracts backward compatible",
      body: "All MCP clients must compile against the shared contracts package.",
      bodyTruncated: false,
      priority: 90,
      proposedBy: "claude-code",
      approvalId: "approval-knowledge"
    }]
  },
  manifest: {
    version: "8f2ac01e8f2ac01e8f2ac01e8f2ac01e8f2ac01e8f2ac01e8f2ac01e8f2ac01e",
    stale: false,
    generatedAt: "2026-08-15T10:00:00.000Z",
    durationMs: 1.5,
    byteSize: 1096,
    estimatedTokens: 274,
    discoveredFiles: 18,
    sourceFiles: 12,
    omitted: { truncated: false }
  },
  vault: {
    state: "unlocked",
    profile: "staging",
    variableNames: ["DB_PASSWORD", "AWS_SECRET_KEY"],
    expiresAt: "2026-08-15T10:15:00.000Z"
  },
  approvals: [{
    ok: true,
    status: "pending",
    approvalId: "approval-demo",
    actionDigest: "a".repeat(64),
    requester: "claude-code",
    targetAlias: "demo-staging",
    commandId: "demo-staging-reload",
    arguments: [],
    workingDirectory: ".",
    policyReason: "Protected staging action requires review.",
    environmentVariableNames: ["DB_PASSWORD", "AWS_SECRET_KEY"],
    createdAt: "2026-08-15T10:00:00.000Z",
    expiresAt: "2099-08-15T10:05:00.000Z",
    correlationId: "correlation-demo",
    actionKind: "command",
    knowledge: null
  }],
  audit: [{
    id: "approval-1",
    timestamp: "2026-08-15T10:00:00.000Z",
    type: "approval",
    actor: "claude-code",
    target: "demo-staging",
    outcome: "demo-staging-reload · pending",
    correlationId: "correlation-demo"
  }]
};

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/decision")) {
      return new Response(JSON.stringify({ status: "succeeded" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("quiet developer cockpit", () => {
  it("shows high-signal state with clear units, labels, and resource-lock chips", async () => {
    render(<App initialMode="cockpit" />);
    expect(await screen.findByText("Refactor the shared API")).toBeTruthy();
    expect(screen.getByText("src/engine/core.ts").className).toContain("path-chip");
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText(/human approval required/i)).toBeTruthy();
    expect(screen.getAllByText("DB_PASSWORD").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("actual-secret-value");
    expect(screen.getAllByText("CLOUD DEGRADED · LOCAL ACTIVE").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("274");
    expect(document.body.textContent).toContain("tokens");
    expect(screen.getAllByText("codex").length).toBeGreaterThan(0);
    expect(screen.getByText("1 ACTIVE")).toBeTruthy();
  });

  it("reports an unconfigured optional cloud plane as local-only rather than a fault", async () => {
    // A deliberately unconfigured advisory plane must never render as DEGRADED, since the
    // local control plane is fully operational without it.
    const localOnly: DashboardSnapshot = {
      ...snapshot,
      service: {
        ...snapshot.service,
        cloudIntelligence: "local_only",
        cloudMessage: "Local-only mode · All coordination and approvals active"
      }
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(localOnly), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    render(<App initialMode="cockpit" />);
    expect(await screen.findByText("LOCAL-ONLY · READY")).toBeTruthy();
    expect(document.body.textContent).not.toContain("DEGRADED");
    expect(document.body.textContent).not.toContain("not configured");
  });

  it("keeps approval shortcuts scoped to the focused approval card", async () => {
    const user = userEvent.setup();
    render(<App initialMode="cockpit" />);
    await screen.findByText("Approve & execute");
    const filter = screen.getByLabelText("Filter cockpit");
    filter.focus();
    await user.keyboard("a");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/decision"))).toBe(false);

    const card = document.getElementById("approval");
    expect(card).not.toBeNull();
    card!.focus();
    await user.keyboard("a");
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/decision"))).toBe(true);
    });
  });

  it("supports G-key section navigation", async () => {
    const user = userEvent.setup();
    render(<App initialMode="cockpit" />);
    await screen.findByText("Audit stream");
    await user.keyboard("gu");
    expect(document.activeElement?.id).toBe("audit");
  });

  it("renders Superdesign Studio mode by default with welcome hero and suggestions", async () => {
    render(<App initialMode="studio" />);
    expect(await screen.findByText("Belay Studio")).toBeTruthy();
    expect(screen.getByText("Audit MQL Parity")).toBeTruthy();
    expect(screen.getByText("Error Handling")).toBeTruthy();
    expect(screen.getByText("Security Posture")).toBeTruthy();
    expect(screen.getByText("Gemini Fleet Plan")).toBeTruthy();
  });
});

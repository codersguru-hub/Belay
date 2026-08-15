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
  project: { id: "project-demo", name: "agentmesh-demo", root: "D:/demo" },
  agents: [
    { name: "codex", activeTasks: 1, state: "active" },
    { name: "claude-code", activeTasks: 0, state: "idle" }
  ],
  summary: { activeTasks: 1, lockedFiles: 1, pendingApprovals: 1 },
  tasks: [{
    id: "task-refactor",
    title: "Refactor API",
    agentName: "codex",
    leaseExpiresAt: "2099-08-15T10:10:00.000Z",
    lockedFiles: ["src/engine/core.ts"],
    omittedLockedFiles: 0
  }],
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
    correlationId: "correlation-demo"
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
    render(<App />);
    expect(await screen.findByText("274 tok")).toBeTruthy();
    expect(screen.getByText("1 Active / 1 Idle")).toBeTruthy();
    expect(screen.getByText("src/engine/core.ts").className).toContain("path-chip");
    expect(screen.getByText(/human approval required/i)).toBeTruthy();
    expect(screen.getAllByText("DB_PASSWORD").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("actual-secret-value");
    expect(screen.getAllByText("DEGRADED · LOCAL ACTIVE").length).toBeGreaterThan(0);
  });

  it("keeps approval shortcuts scoped to the focused approval card", async () => {
    const user = userEvent.setup();
    render(<App />);
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
    render(<App />);
    await screen.findByText("Audit stream");
    await user.keyboard("gu");
    expect(document.activeElement?.id).toBe("audit");
  });
});

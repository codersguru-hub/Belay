import { useCallback, useEffect, useState } from "react";
import type { DashboardSnapshot, PendingApproval } from "./types";

export function useDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<"live" | "polling">("polling");
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error("Dashboard projection unavailable");
      setSnapshot(await response.json() as DashboardSnapshot);
      setError(null);
    } catch {
      setError("Local dashboard data is unavailable. Core daemon state is unchanged.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/events`);
    socket.addEventListener("open", () => setConnection("live"));
    socket.addEventListener("message", () => void refresh());
    socket.addEventListener("close", () => setConnection("polling"));
    socket.addEventListener("error", () => setConnection("polling"));
    return () => {
      window.clearInterval(interval);
      socket.close();
    };
  }, [refresh]);

  const decide = useCallback(async (
    approval: PendingApproval,
    decision: "approve" | "reject"
  ) => {
    setDecisionPending(approval.approvalId);
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approval.approvalId)}/decision`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ decision, expectedDigest: approval.actionDigest })
      });
      const body = await response.json() as { status?: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Decision was not accepted");
      setAnnouncement(
        decision === "approve"
          ? approval.actionKind === "knowledge"
            ? `Approval accepted. Shared fact finished with status ${body.status ?? "unknown"}.`
            : `Approval accepted. Action finished with status ${body.status ?? "unknown"}.`
          : "Action rejected. The executor was not invoked."
      );
      await refresh();
    } catch (caught) {
      setAnnouncement(caught instanceof Error ? caught.message : "Decision failed safely.");
    } finally {
      setDecisionPending(null);
    }
  }, [refresh]);

  return { snapshot, error, connection, decisionPending, announcement, refresh, decide };
}

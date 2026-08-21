import type { ApprovalStatus } from "@belay/contracts";

export interface ApprovalEvent {
  type: "approval.updated";
  approvalId: string;
  projectId: string;
  status: ApprovalStatus;
  actionDigest: string;
  targetAlias: string;
  commandId: string;
  correlationId: string;
  occurredAt: string;
}

export class ApprovalEventHub {
  private readonly listeners = new Set<(event: ApprovalEvent) => void>();

  subscribe(listener: (event: ApprovalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ApprovalEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

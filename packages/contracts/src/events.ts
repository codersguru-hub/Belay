export const COORDINATION_EVENT_TYPES = [
  "task_acquired",
  "progress",
  "completed",
  "blocked",
  "lock_expired",
  "system"
] as const;

export type CoordinationEventType = (typeof COORDINATION_EVENT_TYPES)[number];


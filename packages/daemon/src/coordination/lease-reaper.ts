import type { CoordinationService } from "./coordination-service.js";

export class LeaseReaper {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly coordination: CoordinationService,
    private readonly intervalMilliseconds = 5_000
  ) {}

  start(): void {
    if (this.timer || this.intervalMilliseconds <= 0) {
      return;
    }
    this.timer = setInterval(() => {
      try {
        this.coordination.reapExpiredLeases();
      } catch {
        // Request paths also reap before reads/writes; a transient sweep failure fails closed.
      }
    }, this.intervalMilliseconds);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }
}


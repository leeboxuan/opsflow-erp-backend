export type ConfirmPerfPhase = { name: string; ms: number };

export type ConfirmPerfSnapshot = {
  totalMs: number;
  phases: ConfirmPerfPhase[];
};

/** Opt-in: JOB_MESSAGE_IMPORT_CONFIRM_PERF=1. Never on by default in production. */
export function isJobMessageImportConfirmPerfEnabled(): boolean {
  return process.env.JOB_MESSAGE_IMPORT_CONFIRM_PERF === "1";
}

export class ConfirmPerfTracker {
  private readonly startedAt = Date.now();
  private readonly phases: ConfirmPerfPhase[] = [];

  record(name: string, ms: number): void {
    this.phases.push({ name, ms });
  }

  async measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this.phases.push({ name, ms: Date.now() - t0 });
    }
  }

  snapshot(): ConfirmPerfSnapshot {
    return {
      totalMs: Date.now() - this.startedAt,
      phases: [...this.phases],
    };
  }

  flush(): ConfirmPerfSnapshot {
    const snap = this.snapshot();
    if (isJobMessageImportConfirmPerfEnabled()) {
      console.info("job_message_import_confirm_perf", snap);
    }
    return snap;
  }
}

import type { PublicIntakeRepository } from "../../conversations/repositories/public-intake-repository.js";
import type { PublicWidgetIntakeService } from "../use-cases/public-widget-intake-service.js";

export type WidgetAiJobWorkerOptions = {
  pollIntervalMs: number;
  leaseMs: number;
  retryBackoffMs: number;
  onError?: (error: unknown) => void;
};

export class WidgetAiJobWorker {
  constructor(
    private readonly repository: PublicIntakeRepository,
    private readonly service: PublicWidgetIntakeService,
    private readonly options: WidgetAiJobWorkerOptions
  ) {}

  async runOnce(now = new Date()): Promise<boolean> {
    if (!this.repository.claimSiteWidgetAiJob || !this.repository.finishSiteWidgetAiJob) {
      return false;
    }

    const job = await this.repository.claimSiteWidgetAiJob({
      leaseMs: this.options.leaseMs,
      now
    });

    if (!job) {
      return false;
    }

    try {
      const result = await this.service.processClaimedSiteWidgetAiJob(job);
      await this.repository.finishSiteWidgetAiJob({
        jobId: job.id,
        attemptCount: job.attemptCount,
        status: result.status,
        terminalReason: result.terminalReason,
        outputPublicMessageId: result.outputPublicMessageId,
        completedAt: new Date()
      });
    } catch (error) {
      const completedAt = new Date();
      const retrying = job.attemptCount < job.maxAttempts;
      await this.repository.finishSiteWidgetAiJob({
        jobId: job.id,
        attemptCount: job.attemptCount,
        status: retrying ? "retrying" : "failed",
        terminalReason: "worker_failed",
        lastError: error instanceof Error ? error.message : String(error),
        retryAt: retrying
          ? new Date(completedAt.getTime() + this.options.retryBackoffMs)
          : undefined,
        completedAt
      });
    }

    return true;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const processed = await this.runOnce();

        if (processed) {
          continue;
        }
      } catch (error) {
        this.options.onError?.(error);
      }

      if (!signal.aborted) {
        await waitForAbortableDelay(this.options.pollIntervalMs, signal);
      }
    }
  }
}

function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(done, Math.max(25, delayMs));

    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }

    signal.addEventListener("abort", done, { once: true });
  });
}

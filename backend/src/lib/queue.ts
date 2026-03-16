import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Simple in-process job queue (Redis-backed BullMQ can be swapped in later)
// ---------------------------------------------------------------------------

type JobHandler = (data: unknown) => Promise<void>;

interface ScheduledJob {
  name: string;
  handler: JobHandler;
  intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
}

class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private scheduled: ScheduledJob[] = [];

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown = {}): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      console.warn(`[queue] No handler registered for job "${name}"`);
      return;
    }
    // Run asynchronously so caller isn't blocked
    handler(data).catch((err) => {
      console.error(`[queue] Job "${name}" failed:`, err);
    });
  }

  schedule(name: string, handler: JobHandler, intervalMs: number): void {
    this.register(name, handler);
    const job: ScheduledJob = { name, handler, intervalMs };
    job.timer = setInterval(() => {
      handler({}).catch((err) => console.error(`[queue] Scheduled job "${name}" failed:`, err));
    }, intervalMs);
    this.scheduled.push(job);
  }

  shutdown(): void {
    for (const job of this.scheduled) {
      if (job.timer) clearInterval(job.timer);
    }
    this.scheduled = [];
  }
}

export const jobQueue = new JobQueue();

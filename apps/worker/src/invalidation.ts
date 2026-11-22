import { toMessage } from './outbox';

export const INVALIDATION_TOPICS = ['price.changed', 'stock.changed'];
export const INVALIDATOR_GROUP = 'cache-invalidator';

export function invalidationKeys(topic: string, key: string | undefined, body: string | undefined): string[] | null {
  if (!body || !key) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || !('event_id' in payload) || typeof payload.event_id !== 'string') {
    return null;
  }

  if (!toMessage({ id: payload.event_id, topic, key, payload })) return null;

  return [`product:${key}`, `pstats:${key}`, `lock:product:${key}`];
}

interface InvalidateJob {
  keys: string[] | null;
  signal: AbortSignal;
  invalidate(keys: string[]): Promise<unknown>;
  commit(): Promise<void>;
  pause(): () => void;
  wait(attempt: number): Promise<void>;
}

export async function processInvalidation(job: InvalidateJob): Promise<'invalid' | 'success' | 'stopped'> {
  let resume: (() => void) | undefined;
  try {
    if (job.keys) {
      let attempt = 0;
      while (!job.signal.aborted) {
        try {
          await job.invalidate(job.keys);
          break;
        } catch {
          resume ??= job.pause();
          await job.wait(++attempt);
        }
      }
    }
    if (job.signal.aborted) return 'stopped';
    await job.commit();
    return job.keys ? 'success' : 'invalid';
  } finally {
    if (!job.signal.aborted) resume?.();
  }
}

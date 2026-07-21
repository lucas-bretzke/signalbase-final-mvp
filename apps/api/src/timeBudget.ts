import { randomUUID } from 'node:crypto';
import type { WorkerRequestOptions } from './types.js';

export const MIN_WORKER_TIMEOUT_MS = 1;
export const MAX_WORKER_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export type BudgetAbortCode = 'deadline_exceeded' | 'request_cancelled';

export interface TimeBudget {
  requestId: string;
  startedAt: number;
  deadline: number;
  signal: AbortSignal;
  remainingMs(now?: number): number;
  abortCode(): BudgetAbortCode | undefined;
  abortCause(): unknown;
  dispose(): void;
}

class BudgetAbortReason extends Error {
  constructor(readonly code: BudgetAbortCode) {
    super(code === 'deadline_exceeded' ? 'Worker request deadline exceeded.' : 'Worker request cancelled.');
    this.name = 'BudgetAbortReason';
  }
}

export function createTimeBudget(
  options: WorkerRequestOptions,
  defaultTimeoutMs: number,
  now: () => number = Date.now,
): TimeBudget {
  const startedAt = now();
  const timeoutMs = validTimeout(defaultTimeoutMs);
  const configuredDeadline = options.deadline === undefined
    ? undefined
    : validAbsoluteDeadline(options.deadline, startedAt);
  const deadline = Math.min(configuredDeadline ?? Number.MAX_SAFE_INTEGER, startedAt + timeoutMs);
  const requestId = validRequestId(options.requestId);
  const controller = new AbortController();
  let code: BudgetAbortCode | undefined;
  let cause: unknown;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let listeningToExternalSignal = false;

  const abort = (nextCode: BudgetAbortCode, nextCause: unknown): void => {
    if (controller.signal.aborted) return;
    code = nextCode;
    cause = nextCause;
    controller.abort(nextCause);
  };

  const onExternalAbort = (): void => {
    abort('request_cancelled', options.signal?.reason);
  };

  if (options.signal?.aborted) {
    onExternalAbort();
  } else if (options.signal) {
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
    listeningToExternalSignal = true;
  }

  const delayMs = deadline - startedAt;
  if (!controller.signal.aborted) {
    if (delayMs <= 0) {
      abort('deadline_exceeded', new BudgetAbortReason('deadline_exceeded'));
    } else {
      timeout = setTimeout(() => {
        abort('deadline_exceeded', new BudgetAbortReason('deadline_exceeded'));
      }, delayMs);
      timeout.unref?.();
    }
  }

  let disposed = false;
  return {
    requestId,
    startedAt,
    deadline,
    signal: controller.signal,
    remainingMs(at = now()) {
      return Math.max(0, deadline - at);
    },
    abortCode() {
      return code;
    },
    abortCause() {
      return cause;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (listeningToExternalSignal) {
        options.signal?.removeEventListener('abort', onExternalAbort);
        listeningToExternalSignal = false;
      }
    },
  };
}

function validTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_WORKER_TIMEOUT_MS || value > MAX_WORKER_TIMEOUT_MS) {
    throw new RangeError(
      `Worker timeout must be an integer between ${MIN_WORKER_TIMEOUT_MS} and ${MAX_WORKER_TIMEOUT_MS} milliseconds.`,
    );
  }
  return value;
}

function validAbsoluteDeadline(value: number, now: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('Worker deadline must be a positive Unix timestamp in milliseconds.');
  }
  if (value > now + MAX_WORKER_TIMEOUT_MS) {
    throw new RangeError(`Worker deadline cannot be more than ${MAX_WORKER_TIMEOUT_MS} milliseconds in the future.`);
  }
  return value;
}

function validRequestId(value: string | undefined): string {
  if (value === undefined) return randomUUID();
  const requestId = value.trim();
  if (!requestId || requestId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    throw new TypeError('Worker requestId must contain 1-128 letters, digits, dots, underscores, colons, or hyphens.');
  }
  return requestId;
}

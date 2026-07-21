import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 110_000;
const MAX_TIMEOUT_MS = 300_000;

const ERROR_DETAILS = Object.freeze({
  request_cancelled: { status: 499, message: 'A requisicao foi cancelada pelo cliente.' },
  deadline_exceeded: { status: 504, message: 'O prazo da operacao foi excedido.' },
  queue_timeout: { status: 503, message: 'O tempo maximo de espera na fila foi excedido.' },
  queue_full: { status: 503, message: 'A fila do worker esta cheia.' },
  network_error: { status: 502, message: 'Falha transitoria de rede durante a navegacao.' },
  auth_required: { status: 401, message: 'A sessao autorizada do LinkedIn precisa de login.' },
  challenge: { status: 409, message: 'O LinkedIn solicitou verificacao manual.' },
  navigation_error: { status: 502, message: 'A pagina nao pode ser carregada.' },
  worker_unavailable: { status: 503, message: 'O navegador do worker esta indisponivel.' },
  worker_unauthorized: { status: 401, message: 'Token de acesso ao worker ausente ou invalido.' },
  invalid_request: { status: 400, message: 'A requisicao enviada ao worker e invalida.' },
});

export class WorkerOperationError extends Error {
  constructor(code, message, options = {}) {
    const detail = ERROR_DETAILS[code] ?? ERROR_DETAILS.navigation_error;
    super(message || detail.message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'WorkerOperationError';
    this.code = code in ERROR_DETAILS ? code : 'navigation_error';
    this.status = options.status ?? detail.status;
  }
}

export class OperationContext {
  constructor({
    requestId,
    deadline,
    signal,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    maxTimeoutMs = MAX_TIMEOUT_MS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.now = now;
    this.startedAt = now();
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxTimeoutMs = maxTimeoutMs;
    this.requestId = normalizeRequestId(requestId);
    this.deadline = normalizeDeadline(deadline, this.startedAt, this.defaultTimeoutMs, this.maxTimeoutMs);
    this.queueWaitMs = 0;
    this.stageDurations = new Map();
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.externalSignal = signal;
    this.externalAbortListener = undefined;

    if (signal) {
      this.externalAbortListener = () => this.abort(errorFromAbortSignal(signal));
      if (signal.aborted) this.externalAbortListener();
      else signal.addEventListener('abort', this.externalAbortListener, { once: true });
    }

    this.scheduleDeadlineTimer();
  }

  elapsedMs() {
    return Math.max(0, this.now() - this.startedAt);
  }

  remainingMs() {
    return Math.max(0, this.deadline - this.now());
  }

  addQueueWait(durationMs) {
    this.queueWaitMs += Math.max(0, Math.trunc(durationMs));
  }

  setRequestId(value) {
    this.requestId = normalizeRequestId(value);
  }

  setDeadline(value) {
    this.deadline = normalizeDeadline(value, this.startedAt, this.defaultTimeoutMs, this.maxTimeoutMs);
    this.scheduleDeadlineTimer();
  }

  async stage(name, action) {
    this.throwIfUnavailable();
    const startedAt = this.now();
    try {
      return await action();
    } finally {
      const duration = Math.max(0, this.now() - startedAt);
      this.stageDurations.set(name, (this.stageDurations.get(name) ?? 0) + duration);
    }
  }

  throwIfUnavailable(minimumRemainingMs = 0) {
    if (this.signal.aborted) throw errorFromAbortSignal(this.signal);
    if (this.remainingMs() <= Math.max(0, minimumRemainingMs)) {
      const error = new WorkerOperationError('deadline_exceeded');
      this.abort(error);
      throw error;
    }
  }

  abort(reason = new WorkerOperationError('request_cancelled')) {
    if (!this.signal.aborted) this.controller.abort(asOperationError(reason, undefined, 'request_cancelled'));
  }

  wait(durationMs) {
    this.throwIfUnavailable();
    const waitMs = Math.max(0, Math.min(Number(durationMs) || 0, this.remainingMs()));
    if (waitMs === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = (error) => {
        this.clearTimer(timer);
        this.signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => done(errorFromAbortSignal(this.signal));
      const timer = this.setTimer(() => done(), waitMs);
      this.signal.addEventListener('abort', onAbort, { once: true });
      if (this.signal.aborted) onAbort();
    });
  }

  dispose() {
    if (this.deadlineTimer) this.clearTimer(this.deadlineTimer);
    if (this.externalSignal && this.externalAbortListener) {
      this.externalSignal.removeEventListener('abort', this.externalAbortListener);
    }
  }

  scheduleDeadlineTimer() {
    if (this.deadlineTimer) this.clearTimer(this.deadlineTimer);
    if (this.signal.aborted) return;
    const delayMs = Math.max(0, this.deadline - this.now());
    this.deadlineTimer = this.setTimer(() => {
      this.abort(new WorkerOperationError('deadline_exceeded'));
    }, delayMs);
    this.deadlineTimer?.unref?.();
  }
}

export class SerialOperationQueue {
  constructor({ maxDepth = 8, waitTimeoutMs = 30_000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.maxDepth = boundedInteger(maxDepth, 8, 1, 1000);
    this.waitTimeoutMs = boundedInteger(waitTimeoutMs, 30_000, 1, 600_000);
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = [];
    this.active = undefined;
    this.idleWaiters = [];
    this.counters = {
      accepted: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0,
      maxObservedDepth: 0,
      lastQueueWaitMs: 0,
    };
  }

  enqueue(task, { context, operation = 'browser_page' } = {}) {
    if (!(context instanceof OperationContext)) throw new TypeError('OperationContext obrigatorio para a fila.');
    context.throwIfUnavailable();
    if (this.pending.length >= this.maxDepth) {
      this.counters.rejected += 1;
      throw new WorkerOperationError('queue_full');
    }

    return new Promise((resolve, reject) => {
      const item = {
        context,
        operation,
        task,
        enqueuedAt: this.now(),
        resolve,
        reject,
        started: false,
        timer: undefined,
        abortListener: undefined,
      };
      item.abortListener = () => this.removePending(item, errorFromAbortSignal(context.signal));
      context.signal.addEventListener('abort', item.abortListener, { once: true });

      const remainingMs = context.remainingMs();
      const timeoutMs = Math.max(1, Math.min(this.waitTimeoutMs, remainingMs));
      item.timer = this.setTimer(() => {
        const deadlineExpired = context.remainingMs() <= 0;
        this.removePending(item, new WorkerOperationError(deadlineExpired ? 'deadline_exceeded' : 'queue_timeout'));
      }, timeoutMs);

      this.pending.push(item);
      this.counters.accepted += 1;
      this.counters.maxObservedDepth = Math.max(this.counters.maxObservedDepth, this.pending.length);
      this.drain();
    });
  }

  removePending(item, error) {
    if (item.started) return;
    const index = this.pending.indexOf(item);
    if (index < 0) return;
    this.pending.splice(index, 1);
    this.cleanupItem(item);
    this.counters.rejected += 1;
    if (error?.code === 'request_cancelled' || error?.code === 'deadline_exceeded') this.counters.cancelled += 1;
    item.reject(error);
    this.resolveIdleIfNeeded();
  }

  drain() {
    if (this.active) return;
    const item = this.pending.shift();
    if (!item) {
      this.resolveIdleIfNeeded();
      return;
    }

    item.started = true;
    this.cleanupItem(item);
    const queueWaitMs = Math.max(0, this.now() - item.enqueuedAt);
    item.context.addQueueWait(queueWaitMs);
    this.counters.lastQueueWaitMs = queueWaitMs;
    this.active = {
      operation: item.operation,
      context: item.context,
      requestId: item.context.requestId,
      startedAt: this.now(),
    };

    const complete = (error) => {
      this.counters.completed += 1;
      if (error?.code === 'request_cancelled' || error?.code === 'deadline_exceeded') {
        this.counters.cancelled += 1;
      }
      this.active = undefined;
      this.drain();
    };

    const taskPromise = Promise.resolve()
      .then(() => {
        item.context.throwIfUnavailable();
        return item.task({ queueWaitMs });
      });
    raceWithAbort(taskPromise, item.context)
      .then(
        (value) => {
          complete();
          item.resolve(value);
        },
        (error) => {
          complete(error);
          item.reject(error);
        },
      );
    taskPromise.catch(() => undefined);
  }

  cleanupItem(item) {
    if (item.timer) this.clearTimer(item.timer);
    if (item.abortListener) item.context.signal.removeEventListener('abort', item.abortListener);
  }

  health() {
    return {
      queueDepth: this.pending.length,
      maxQueueDepth: this.maxDepth,
      queueWaitTimeoutMs: this.waitTimeoutMs,
      activeOperation: this.active ? {
        operation: this.active.operation,
        requestId: this.active.requestId,
        elapsedMs: Math.max(0, this.now() - this.active.startedAt),
      } : null,
      ...this.counters,
    };
  }

  cancelAll(reason = new WorkerOperationError('request_cancelled')) {
    const error = asOperationError(reason, undefined, 'request_cancelled');
    for (const item of [...this.pending]) this.removePending(item, error);
    this.active?.context?.abort(error);
  }

  onIdle({ timeoutMs } = {}) {
    if (!this.active && this.pending.length === 0) return Promise.resolve();
    const waitMs = Number(timeoutMs);
    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) this.clearTimer(timer);
        const index = this.idleWaiters.indexOf(finish);
        if (index >= 0) this.idleWaiters.splice(index, 1);
        resolve();
      };
      if (Number.isFinite(waitMs) && waitMs > 0) {
        timer = this.setTimer(finish, Math.trunc(waitMs));
        timer?.unref?.();
      }
      this.idleWaiters.push(finish);
    });
  }

  resolveIdleIfNeeded() {
    if (this.active || this.pending.length) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

function raceWithAbort(promise, context) {
  const signal = context?.signal;
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (action) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = () => finish(() => reject(errorFromAbortSignal(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

export function createOperationContext(options) {
  return new OperationContext(options);
}

export function asOperationError(error, context, fallbackCode = 'navigation_error') {
  if (error instanceof WorkerOperationError) return error;
  if (context?.signal?.aborted) return errorFromAbortSignal(context.signal);
  if (isAbortError(error)) return new WorkerOperationError('request_cancelled', undefined, { cause: error });
  if (isNetworkError(error)) return new WorkerOperationError('network_error', undefined, { cause: error });
  if (isTimeoutError(error)) return new WorkerOperationError('navigation_error', undefined, { cause: error });
  return new WorkerOperationError(fallbackCode, undefined, { cause: error });
}

export function errorFromAbortSignal(signal) {
  if (signal?.reason instanceof WorkerOperationError) return signal.reason;
  if (signal?.reason?.code === 'deadline_exceeded') return new WorkerOperationError('deadline_exceeded');
  return new WorkerOperationError('request_cancelled');
}

export function statusForError(error) {
  return error instanceof WorkerOperationError ? error.status : 500;
}

export function sanitizeRequestId(value) {
  return normalizeRequestId(value);
}

function normalizeRequestId(value) {
  const candidate = String(value ?? '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
  return candidate || randomUUID();
}

function normalizeDeadline(value, now, defaultTimeoutMs, maxTimeoutMs) {
  const fallback = boundedInteger(defaultTimeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
  const maximum = boundedInteger(maxTimeoutMs, MAX_TIMEOUT_MS, fallback, 900_000);
  if (value === undefined || value === null || String(value).trim() === '') return now + fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > now + maximum) {
    throw new WorkerOperationError('invalid_request', `Deadline invalido; use epoch em milissegundos ate ${maximum} ms no futuro.`);
  }
  return parsed;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(String(error?.message ?? ''));
}

function isNetworkError(error) {
  const message = String(error?.message ?? '');
  return /net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_HTTP2|socket hang up|connection (?:closed|reset)|network/i.test(message);
}

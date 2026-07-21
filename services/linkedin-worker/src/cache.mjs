import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CURRENT_SCHEMA_VERSION = 2;
const NON_CACHEABLE_CODES = new Set([
  'auth_required',
  'challenge',
  'navigation_error',
  'network_error',
  'deadline_exceeded',
  'request_cancelled',
  'queue_timeout',
  'queue_full',
  'worker_unavailable',
  'wrong_worker',
]);

export class JsonCache {
  constructor(filePath, options = {}) {
    const normalized = typeof options === 'number' ? { ttlMs: options } : options;
    this.filePath = filePath;
    this.ttlMs = positiveInteger(normalized.ttlMs, 168 * 60 * 60 * 1_000);
    this.negativeTtlMs = positiveInteger(normalized.negativeTtlMs, 15 * 60 * 1_000);
    this.emptyTtlMs = positiveInteger(normalized.emptyTtlMs, this.negativeTtlMs);
    this.schemaVersion = positiveInteger(normalized.schemaVersion, CURRENT_SCHEMA_VERSION);
    this.extractorVersion = String(normalized.extractorVersion || 'unknown');
    this.mode = String(normalized.mode || 'real');
    this.now = normalized.now ?? Date.now;
    this.entries = new Map();
    this.writeTail = Promise.resolve();
    this.document = emptyDocument(this.schemaVersion);
    this.storagePath = filePath;
  }

  get namespaceKey() {
    return `${this.mode}:${this.extractorVersion}`;
  }

  async initialize() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (isCurrentDocument(parsed, this.schemaVersion)) {
        this.document = parsed;
      } else {
        // Migrate valid legacy content as opaque data on the next atomic write.
        // It is never used by a different extractor/mode and is not discarded.
        this.document = { ...emptyDocument(this.schemaVersion), legacyDocuments: [parsed] };
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      if (error?.name !== 'SyntaxError') throw error;
      // A corrupt primary cache is left untouched. New compatible entries use a
      // deterministic sidecar so startup remains safe and no data is destroyed.
      this.storagePath = compatibleSidecarPath(this.filePath, this.schemaVersion, this.mode, this.extractorVersion);
      await this.loadCompatibleSidecar();
    }

    this.loadNamespace();
    if (this.pruneExpired() > 0) await this.flush();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!isCompatibleEntry(entry, this) || this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.value);
  }

  async set(key, value, options = {}) {
    const ttlMs = positiveInteger(options.ttlMs, this.ttlMs);
    const storedAt = this.now();
    this.entries.set(key, {
      storedAt,
      expiresAt: storedAt + ttlMs,
      kind: options.kind ?? 'positive',
      schemaVersion: this.schemaVersion,
      extractorVersion: this.extractorVersion,
      mode: this.mode,
      value: structuredClone(value),
    });
    this.writeTail = this.writeTail.then(() => this.flush(), () => this.flush());
    await this.writeTail;
  }

  async setResult(key, value) {
    const policy = cachePolicyFor(value, this);
    if (!policy.cache) return false;
    await this.set(key, value, policy);
    return true;
  }

  async close() {
    await this.writeTail;
  }

  async flush() {
    this.pruneExpired();
    this.document.schemaVersion = this.schemaVersion;
    this.document.namespaces ??= {};
    this.document.namespaces[this.namespaceKey] = {
      mode: this.mode,
      extractorVersion: this.extractorVersion,
      entries: Object.fromEntries(this.entries),
    };
    await mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(this.document, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.storagePath);
      await chmod(this.storagePath, 0o600).catch(() => undefined);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async loadCompatibleSidecar() {
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, 'utf8'));
      if (isCurrentDocument(parsed, this.schemaVersion)) this.document = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.name !== 'SyntaxError') throw error;
    }
  }

  loadNamespace() {
    const namespace = this.document.namespaces?.[this.namespaceKey];
    if (namespace?.mode !== this.mode || namespace?.extractorVersion !== this.extractorVersion) return;
    for (const [key, entry] of Object.entries(namespace.entries ?? {})) {
      if (isCompatibleEntry(entry, this) && this.now() < entry.expiresAt) this.entries.set(key, entry);
    }
  }

  pruneExpired() {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (!isCompatibleEntry(entry, this) || now >= entry.expiresAt) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    for (const namespace of Object.values(this.document.namespaces ?? {})) {
      if (!namespace?.entries || typeof namespace.entries !== 'object') continue;
      for (const [key, entry] of Object.entries(namespace.entries)) {
        if (Number.isFinite(entry?.expiresAt) && now >= entry.expiresAt) {
          delete namespace.entries[key];
          removed += 1;
        }
      }
    }
    return removed;
  }
}

export function cachePolicyFor(value, options = {}) {
  const code = value?.errorCode ?? value?.code;
  if (NON_CACHEABLE_CODES.has(code)) return { cache: false, kind: 'transient' };

  const negativeTtlMs = positiveInteger(options.negativeTtlMs, 15 * 60 * 1_000);
  const emptyTtlMs = positiveInteger(options.emptyTtlMs, negativeTtlMs);
  const ttlMs = positiveInteger(options.ttlMs, 168 * 60 * 60 * 1_000);

  if (isEmptyContacts(value)) return { cache: true, ttlMs: emptyTtlMs, kind: 'empty' };
  if (value?.verificationLevel === 'url_only') {
    return { cache: true, ttlMs: negativeTtlMs, kind: 'unverified' };
  }
  if (code === 'no_verified_match' || code === 'no_company_candidate' || code === 'company_not_verified' || value?.success === false) {
    return { cache: true, ttlMs: negativeTtlMs, kind: 'negative' };
  }
  return { cache: true, ttlMs, kind: 'positive' };
}

function emptyDocument(schemaVersion) {
  return { schemaVersion, namespaces: {} };
}

function isCurrentDocument(value, schemaVersion) {
  return value && value.schemaVersion === schemaVersion && value.namespaces && typeof value.namespaces === 'object';
}

function isCompatibleEntry(entry, cache) {
  return entry
    && entry.schemaVersion === cache.schemaVersion
    && entry.extractorVersion === cache.extractorVersion
    && entry.mode === cache.mode
    && Number.isFinite(entry.storedAt)
    && Number.isFinite(entry.expiresAt);
}

function isEmptyContacts(value) {
  return value
    && Array.isArray(value.emails)
    && Array.isArray(value.phones)
    && value.emails.length === 0
    && value.phones.length === 0;
}

function compatibleSidecarPath(filePath, schemaVersion, mode, extractorVersion) {
  const identity = `${mode}-${extractorVersion}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  return `${filePath}.v${schemaVersion}.${identity}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

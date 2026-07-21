import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class JsonCache {
  constructor(filePath, ttlMs) {
    this.filePath = filePath;
    this.ttlMs = ttlMs;
    this.entries = new Map();
    this.writeTail = Promise.resolve();
  }

  async initialize() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      for (const [key, entry] of Object.entries(parsed.entries ?? {})) this.entries.set(key, entry);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.name !== 'SyntaxError') throw error;
    }
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.value);
  }

  async set(key, value) {
    this.entries.set(key, { storedAt: Date.now(), value });
    this.writeTail = this.writeTail.then(() => this.flush(), () => this.flush());
    await this.writeTail;
  }

  async close() {
    await this.writeTail;
  }

  async flush() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    const entries = Object.fromEntries(this.entries);
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, entries }, null, 2), 'utf8');
    await rename(temporary, this.filePath);
  }
}

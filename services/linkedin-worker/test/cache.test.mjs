import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonCache, cachePolicyFor } from '../src/cache.mjs';

test('uses short TTL for negative and empty results and does not cache transient failures', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'signalbase-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 1_000;
  const cache = new JsonCache(path.join(directory, 'cache.json'), {
    ttlMs: 10_000,
    negativeTtlMs: 100,
    emptyTtlMs: 50,
    schemaVersion: 2,
    extractorVersion: 'test-v1',
    mode: 'real',
    now: () => now,
  });
  await cache.initialize();

  await cache.setResult('negative', { success: false, errorCode: 'no_verified_match' });
  await cache.setResult('empty', { emails: [], phones: [] });
  assert.equal(await cache.setResult('timeout', { success: false, errorCode: 'deadline_exceeded' }), false);
  assert.equal(await cache.setResult('auth', { success: false, errorCode: 'auth_required' }), false);
  assert.equal(cache.get('timeout'), undefined);
  assert.equal(cache.get('auth'), undefined);

  now += 51;
  assert.equal(cache.get('empty'), undefined);
  assert.equal(cache.get('negative').errorCode, 'no_verified_match');
  now += 50;
  assert.equal(cache.get('negative'), undefined);
});

test('isolates mode/extractor namespaces and keeps legacy data instead of using it', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'signalbase-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'cache.json');
  const legacy = JSON.stringify({ schemaVersion: 1, entries: { old: { storedAt: 1, value: { success: true } } } });
  await writeFile(filePath, legacy, 'utf8');

  const realCache = new JsonCache(filePath, { schemaVersion: 2, extractorVersion: 'v2', mode: 'real' });
  await realCache.initialize();
  assert.equal(realCache.get('old'), undefined);
  assert.equal(await readFile(filePath, 'utf8'), legacy);
  await realCache.set('shared-key', { success: true });

  const demoCache = new JsonCache(filePath, { schemaVersion: 2, extractorVersion: 'v2', mode: 'demo' });
  await demoCache.initialize();
  assert.equal(demoCache.get('shared-key'), undefined);
  await demoCache.set('demo-only', { success: true });

  const differentExtractor = new JsonCache(filePath, { schemaVersion: 2, extractorVersion: 'v3', mode: 'real' });
  await differentExtractor.initialize();
  assert.equal(differentExtractor.get('shared-key'), undefined);
  assert.match(await readFile(filePath, 'utf8'), /legacyDocuments/);
});

test('corrupt primary cache does not stop startup and is not overwritten', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'signalbase-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'cache.json');
  await writeFile(filePath, '{partial', 'utf8');
  const cache = new JsonCache(filePath, { schemaVersion: 2, extractorVersion: 'v2', mode: 'real' });
  await cache.initialize();
  await Promise.all([
    cache.set('one', { success: true }),
    cache.set('two', { success: true }),
  ]);
  assert.equal(await readFile(filePath, 'utf8'), '{partial');
  assert.deepEqual(cache.get('one'), { success: true });
  assert.deepEqual(cache.get('two'), { success: true });
});

test('a write prunes expired entries from inactive mode and extractor namespaces', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'signalbase-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'cache.json');
  let now = 1_000;
  const realCache = new JsonCache(filePath, {
    ttlMs: 50,
    schemaVersion: 2,
    extractorVersion: 'v2',
    mode: 'real',
    now: () => now,
  });
  await realCache.initialize();
  await realCache.set('expired-contact', { emails: ['masked-fixture'], phones: [] }, { ttlMs: 50 });

  now += 51;
  const demoCache = new JsonCache(filePath, {
    schemaVersion: 2,
    extractorVersion: 'v3',
    mode: 'demo',
    now: () => now,
  });
  await demoCache.initialize();
  await demoCache.set('current', { success: true });

  const persisted = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(persisted.namespaces['real:v2'].entries['expired-contact'], undefined);
});

test('cache policy explicitly identifies network and cancellation as non-cacheable', () => {
  assert.equal(cachePolicyFor({ errorCode: 'network_error' }).cache, false);
  assert.equal(cachePolicyFor({ errorCode: 'request_cancelled' }).cache, false);
  assert.equal(cachePolicyFor({ errorCode: 'challenge' }).cache, false);
  assert.deepEqual(
    cachePolicyFor(
      { success: true, verificationLevel: 'url_only' },
      { ttlMs: 10_000, negativeTtlMs: 100 },
    ),
    { cache: true, ttlMs: 100, kind: 'unverified' },
  );
});

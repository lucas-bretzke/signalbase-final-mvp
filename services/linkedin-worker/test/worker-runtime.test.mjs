import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { LinkedinBrowserWorker } from '../src/linkedin-browser.mjs';
import { createOperationContext } from '../src/operation.mjs';

const options = {
  mode: 'real',
  cachePath: 'unused-in-tests.json',
  cacheTtlMs: 10_000,
  negativeCacheTtlMs: 100,
  emptyCacheTtlMs: 100,
  cacheSchemaVersion: 2,
  extractorVersion: 'test',
  maxQueueDepth: 2,
  queueWaitTimeoutMs: 500,
  operationTimeoutMs: 2_000,
  maxOperationTimeoutMs: 5_000,
  navigationTimeoutMs: 1_000,
  minNavigationBudgetMs: 100,
  minDelayMs: 0,
  postNavigationDelayMs: 0,
  profileDirectory: '.',
  headless: true,
};

function fakeCache() {
  return {
    initialize: async () => undefined,
    get: () => undefined,
    setResult: async () => true,
    close: async () => undefined,
  };
}

function fakePage() {
  return {
    closeCount: 0,
    setDefaultNavigationTimeout() {},
    setDefaultTimeout() {},
    async setViewport() {},
    async setExtraHTTPHeaders() {},
    async close() { this.closeCount += 1; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function fakeBrowser(pages = []) {
  return {
    connected: true,
    closeCount: 0,
    on() {},
    async newPage() { return pages.shift(); },
    async close() { this.closeCount += 1; },
  };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('cancellation closes the active page and the next queued page runs', async () => {
  const firstPage = fakePage();
  const secondPage = fakePage();
  const pages = [firstPage, secondPage];
  const browser = {
    connected: true,
    on() {},
    async newPage() { return pages.shift(); },
    async close() {},
  };
  const worker = new LinkedinBrowserWorker(options, { cache: fakeCache(), logger: () => undefined });
  worker.browser = browser;
  const firstContext = createOperationContext({ deadline: Date.now() + 2_000 });
  const secondContext = createOperationContext({ deadline: Date.now() + 2_000 });
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });

  const first = worker.withPage(async (_page, context) => {
    markStarted();
    await context.wait(1_000);
  }, firstContext, 'first_page');
  await started;
  const second = worker.withPage(async () => 'next', secondContext, 'second_page');
  firstContext.abort();

  await assert.rejects(first, (error) => error.code === 'request_cancelled');
  assert.equal(await second, 'next');
  assert.ok(firstPage.closeCount >= 1);
  assert.ok(secondPage.closeCount >= 1);
  assert.equal(worker.health().queueDepth, 0);
  assert.equal(worker.health().activeOperation, null);
  assert.equal('profile_directory' in worker.health(), false);

  firstContext.dispose();
  secondContext.dispose();
});

test('navigation is not started without the configured minimum remaining budget', async () => {
  const worker = new LinkedinBrowserWorker(options, { cache: fakeCache(), logger: () => undefined });
  let navigationCalls = 0;
  const page = { async goto() { navigationCalls += 1; } };
  const context = createOperationContext({ deadline: Date.now() + 30, maxTimeoutMs: 5_000 });
  await assert.rejects(worker.navigate(page, 'https://example.invalid', context), (error) => error.code === 'deadline_exceeded');
  assert.equal(navigationCalls, 0);
  context.dispose();
});

test('health is not ready when the worker is disabled, including demo mode', () => {
  const worker = new LinkedinBrowserWorker(
    { ...options, enabled: false, mode: 'demo' },
    { cache: fakeCache(), logger: () => undefined },
  );

  assert.equal(worker.health().ready, false);
  assert.equal(worker.health().readiness_reason, 'disabled');
});

test('browser launch timeout is classified as worker_unavailable', async () => {
  const timeout = Object.assign(new Error('Timed out while launching the browser'), { name: 'TimeoutError' });
  const worker = new LinkedinBrowserWorker(options, {
    cache: fakeCache(),
    logger: () => undefined,
    launchBrowser: async () => { throw timeout; },
  });
  const context = createOperationContext({ deadline: Date.now() + 2_000 });

  await assert.rejects(worker.ensureBrowser(context), (error) => error.code === 'worker_unavailable');
  assert.equal(getEventListeners(context.signal, 'abort').length, 0);
  context.dispose();
});

test('structured operation logs and passive health do not expose contact data or tokens', async () => {
  const events = [];
  const worker = new LinkedinBrowserWorker(options, {
    cache: fakeCache(),
    logger: (event) => events.push(event),
  });
  const context = createOperationContext({ deadline: Date.now() + 2_000 });
  const sensitive = 'ana.silva@example.com +55 11 99999-8888 https://example.invalid/?token=secret';

  await worker.executeOperation('privacy_fixture', context, async () => ({
    success: false,
    errorCode: 'no_verified_match',
    error: sensitive,
  }));

  const serializedLogs = JSON.stringify(events);
  const serializedHealth = JSON.stringify(worker.health());
  for (const forbidden of ['ana.silva@example.com', '99999-8888', 'token=secret']) {
    assert.equal(serializedLogs.includes(forbidden), false);
    assert.equal(serializedHealth.includes(forbidden), false);
  }
  assert.match(serializedHealth, /\[email\]/);
  assert.match(serializedHealth, /\[phone\]/);
  context.dispose();
});

test('cancellation during browser launch releases the queue and closes a browser created late', async () => {
  const pendingLaunch = deferred();
  const lateBrowser = fakeBrowser();
  const nextPage = fakePage();
  const nextBrowser = fakeBrowser([nextPage]);
  let launchCalls = 0;
  let markFirstLaunchStarted;
  const firstLaunchStarted = new Promise((resolve) => { markFirstLaunchStarted = resolve; });
  const worker = new LinkedinBrowserWorker(options, {
    cache: fakeCache(),
    logger: () => undefined,
    launchBrowser: () => {
      launchCalls += 1;
      if (launchCalls === 1) {
        markFirstLaunchStarted();
        return pendingLaunch.promise;
      }
      return Promise.resolve(nextBrowser);
    },
  });
  const firstContext = createOperationContext({ deadline: Date.now() + 2_000 });
  const secondContext = createOperationContext({ deadline: Date.now() + 2_000 });

  const first = worker.withPage(async () => 'never', firstContext, 'launch_cancelled');
  await firstLaunchStarted;
  firstContext.abort();
  await assert.rejects(first, (error) => error.code === 'request_cancelled');

  const second = worker.withPage(async () => 'next', secondContext, 'after_cancelled_launch');
  assert.equal(await second, 'next');
  assert.equal(launchCalls, 2);
  assert.equal(worker.browser, nextBrowser);
  assert.equal(worker.health().activeOperation, null);
  assert.equal(getEventListeners(firstContext.signal, 'abort').length, 0);

  pendingLaunch.resolve(lateBrowser);
  await nextTurn();
  assert.equal(lateBrowser.closeCount, 1);
  assert.equal(worker.browser, nextBrowser);

  firstContext.dispose();
  secondContext.dispose();
});

test('cancellation during newPage releases the queue and closes a page created late', async () => {
  const pendingPage = deferred();
  const latePage = fakePage();
  const nextPage = fakePage();
  let pageCalls = 0;
  let markFirstPageStarted;
  const firstPageStarted = new Promise((resolve) => { markFirstPageStarted = resolve; });
  const browser = fakeBrowser();
  browser.newPage = () => {
    pageCalls += 1;
    if (pageCalls === 1) {
      markFirstPageStarted();
      return pendingPage.promise;
    }
    return Promise.resolve(nextPage);
  };
  const worker = new LinkedinBrowserWorker(options, { cache: fakeCache(), logger: () => undefined });
  worker.browser = browser;
  const firstContext = createOperationContext({ deadline: Date.now() + 2_000 });
  const secondContext = createOperationContext({ deadline: Date.now() + 2_000 });

  const first = worker.withPage(async () => 'never', firstContext, 'page_cancelled');
  await firstPageStarted;
  firstContext.abort();
  await assert.rejects(first, (error) => error.code === 'request_cancelled');

  const second = worker.withPage(async () => 'next', secondContext, 'after_cancelled_page');
  assert.equal(await second, 'next');
  assert.equal(pageCalls, 2);
  assert.equal(worker.health().activeOperation, null);
  assert.equal(getEventListeners(firstContext.signal, 'abort').length, 0);

  pendingPage.resolve(latePage);
  await nextTurn();
  assert.equal(latePage.closeCount, 1);

  firstContext.dispose();
  secondContext.dispose();
});

test('late resource rejection after cancellation is observed', async () => {
  const pendingPage = deferred();
  const browser = fakeBrowser();
  browser.newPage = () => pendingPage.promise;
  const worker = new LinkedinBrowserWorker(options, { cache: fakeCache(), logger: () => undefined });
  worker.browser = browser;
  const context = createOperationContext({ deadline: Date.now() + 2_000 });

  const operation = worker.withPage(async () => 'never', context, 'late_rejection');
  await nextTurn();
  context.abort();
  await assert.rejects(operation, (error) => error.code === 'request_cancelled');
  pendingPage.reject(new Error('late newPage failure'));
  await nextTurn();

  assert.equal(getEventListeners(context.signal, 'abort').length, 0);
  assert.equal(worker.health().activeOperation, null);
  context.dispose();
});

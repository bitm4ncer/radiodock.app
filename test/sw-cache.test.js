import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fetchJson } from '../src/data/stations-api.js';

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('discover.json is network-first, so a Publish reaches the next load', () => {
  assert.match(sw, /const NETWORK_FIRST_DATA = \[[^\]]*'\/discover\.json'/);
});

test('network-first data is not short-circuited before the fetch handler', () => {
  const body = sw.slice(sw.indexOf('function isAppShellRequest'));
  const fn = body.slice(0, body.indexOf('\n}') + 2);
  assert.match(fn, /isNetworkFirstData\(url\)/);
});

test('fetchJson bypasses the browser HTTP cache', async () => {
  const original = globalThis.fetch;
  let init;
  globalThis.fetch = async (_url, options) => {
    init = options;
    return { ok: true, json: async () => ({}) };
  };
  try {
    await fetchJson('/discover.json');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(init.cache, 'no-store');
});

test('a non-success network response falls back to the cached body', async () => {
  const CACHE_BODY = '<html>cached shell</html>';
  const cache = {
    put: async () => {},
    match: async () => new Response(CACHE_BODY, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  };
  const fetchHandlers = [];
  const sandbox = {
    location: { origin: 'https://radiodock.app', pathname: '/' },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {} },
    fetch: async () => new Response('service unavailable', { status: 503 }),
    addEventListener: (type, fn) => { if (type === 'fetch') fetchHandlers.push(fn); },
    Response,
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
  };
  sandbox.self = sandbox;
  vm.runInNewContext(sw, sandbox);
  const req = { method: 'GET', mode: 'navigate', url: 'https://radiodock.app/', clone: () => req };
  let served;
  for (const fn of fetchHandlers) {
    fn({ request: req, respondWith: (p) => { served = p; } });
  }
  const res = await served;
  assert.equal(res.status, 200);
  assert.equal(await res.text(), CACHE_BODY, 'the cached body must be served, not the 503 page');
});

test('install precaches the hashed assets referenced by the shell', async () => {
  const added = [];
  const cache = {
    addAll: (urls) => { added.push(...urls); return Promise.resolve(); },
    match: async () => new Response('', { status: 200 }),
    put: async () => {},
  };
  let installFn;
  const sandbox = {
    location: { origin: 'https://radiodock.app', pathname: '/' },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {} },
    fetch: async () => new Response('<script src="/assets/app-abc123.js"></script><link rel="stylesheet" href="/assets/index-def456.css">', { status: 200 }),
    addEventListener: (type, fn) => { if (type === 'install') installFn = fn; },
    Response,
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
  };
  sandbox.self = sandbox;
  vm.runInNewContext(sw, sandbox);
  let installPromise;
  installFn({ waitUntil: (p) => { installPromise = p; } });
  await installPromise;
  assert.ok(added.includes('/assets/app-abc123.js'));
  assert.ok(added.includes('/assets/index-def456.css'));
});

test('activate keeps the current and previous cache, deleting only older ones', async () => {
  const deleted = [];
  let activateFn;
  const sandbox = {
    location: { origin: 'https://radiodock.app', pathname: '/' },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    caches: { keys: async () => ['radiodock-shell-1', 'radiodock-shell-2', 'radiodock-shell-3'], delete: (k) => { deleted.push(k); return Promise.resolve(true); }, open: async () => ({}) },
    fetch: async () => new Response('', { status: 200 }),
    addEventListener: (type, fn) => { if (type === 'activate') activateFn = fn; },
    Response,
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
  };
  sandbox.self = sandbox;
  vm.runInNewContext(sw.replaceAll('__BUILD_ID__', '3'), sandbox);
  let activatePromise;
  activateFn({ waitUntil: (p) => { activatePromise = p; } });
  await activatePromise;
  assert.deepEqual(deleted, ['radiodock-shell-1']);
});

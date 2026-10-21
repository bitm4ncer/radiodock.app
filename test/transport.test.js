import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../src/data/transport.js';

test('fetchWithTimeout aborts the fetch after the timeout', async () => {
  const original = globalThis.fetch;
  let seenSignal;
  globalThis.fetch = async (_url, init) => {
    seenSignal = init.signal;
    return new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
  };
  try {
    await assert.rejects(() => fetchWithTimeout('https://x', { timeoutMs: 10 }));
    assert.equal(seenSignal.aborted, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchWithTimeout aborts when the caller signal aborts', async () => {
  const original = globalThis.fetch;
  const ctl = new AbortController();
  let seenSignal;
  globalThis.fetch = async (_url, init) => {
    seenSignal = init.signal;
    return new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
  };
  try {
    const p = fetchWithTimeout('https://x', { signal: ctl.signal, timeoutMs: 1000 });
    ctl.abort();
    await assert.rejects(() => p);
    assert.equal(seenSignal.aborted, true);
  } finally {
    globalThis.fetch = original;
  }
});

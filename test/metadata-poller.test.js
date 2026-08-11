import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// The poller is a timer state machine, so these tests drive it with a fake
// clock and record exactly when it reaches for the network.

function makeHarness() {
  const domListeners = new Map();
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(type, fn) {
      if (!domListeners.has(type)) domListeners.set(type, []);
      domListeners.get(type).push(fn);
    },
  };

  const state = {
    fetches: [],
    dispatched: [],
    respond: () => ({ ok: true, display: 'Show A', cacheTtl: 30 }),
    setVisibility(value) {
      globalThis.document.visibilityState = value;
      (domListeners.get('visibilitychange') ?? []).forEach((fn) => fn());
    },
  };

  globalThis.fetch = async () => {
    state.fetches.push(Date.now());
    const body = state.respond();
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const handlers = new Map();
  state.player = {
    events: {
      dispatchEvent: (e) => state.dispatched.push({ t: Date.now(), ...e.detail }),
    },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, detail) {
      (handlers.get(type) ?? []).forEach((fn) => fn({ detail }));
    },
  };
  return state;
}

const flush = () => new Promise((r) => setImmediate(r));

async function advance(ms, step = 1000) {
  for (let i = 0; i < Math.ceil(ms / step); i++) {
    mock.timers.tick(step);
    await flush();
  }
}

const STATION = { url: 'http://stream-relay-geo.ntslive.net/stream', id: 'nts1' };

async function withPoller(run) {
  const h = makeHarness();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { attachMetadataPoller } = await import('../src/player/metadata-poller.js');
  try {
    attachMetadataPoller(h.player);
    h.player.emit('stationchange', { station: STATION });
    await flush();
    await run(h);
  } finally {
    mock.timers.reset();
  }
}

test('polls on the interval the proxy asks for', async () => {
  await withPoller(async (h) => {
    const t0 = h.fetches[0];
    await advance(120_000);
    assert.deepEqual(h.fetches.map((t) => (t - t0) / 1000), [0, 30, 60, 90, 120]);
  });
});

test('a returning listener gets a refresh immediately, not a full interval later', async () => {
  await withPoller(async (h) => {
    await advance(30_000);
    h.setVisibility('hidden');
    await advance(600_000);
    const whileHidden = h.fetches.length;

    h.setVisibility('visible');
    await flush();

    assert.equal(
      h.fetches.length,
      whileHidden + 1,
      'coming back to the tab must refresh now — the show may have changed while it was away',
    );
  });
});

test('the wake-up does not leave a second timer chain running', async () => {
  await withPoller(async (h) => {
    h.setVisibility('hidden');
    await advance(120_000);
    h.setVisibility('visible');
    await flush();

    const afterWake = h.fetches.length;
    await advance(120_000);
    // One chain at 30s cadence = 4 polls, not 8.
    assert.equal(h.fetches.length - afterWake, 4);
  });
});

test('flapping visibility cannot hammer the proxy', async () => {
  await withPoller(async (h) => {
    await advance(30_000);
    const before = h.fetches.length;
    for (let i = 0; i < 10; i++) {
      h.setVisibility('hidden');
      h.setVisibility('visible');
      await flush();
    }
    assert.ok(h.fetches.length - before <= 1, `expected at most one extra fetch, got ${h.fetches.length - before}`);
  });
});

test('a long proxy TTL does not blind the session (NTS mixtapes ship cacheTtl 3600)', async () => {
  await withPoller(async (h) => {
    h.respond = () => ({ ok: true, display: 'Poolside', cacheTtl: 3600 });
    await advance(60_000);
    const before = h.fetches.length;
    await advance(1_800_000, 60_000);
    assert.ok(
      h.fetches.length - before >= 5,
      `30 min must not pass on a single poll — got ${h.fetches.length - before}`,
    );
  });
});

test('a definitive "nothing on air" clears the previous show', async () => {
  await withPoller(async (h) => {
    await advance(1000);
    assert.equal(h.dispatched.at(-1).nowPlaying, 'Show A');

    h.respond = () => ({ ok: false, reason: 'no-metadata', cacheTtl: 30 });
    await advance(60_000);
    assert.equal(
      h.dispatched.at(-1).nowPlaying,
      '',
      'the proxy answered that there is nothing playing — the ended show must not stay on screen',
    );
  });
});

test('an HLS stream is left to its in-band ID3 tags', async () => {
  await withPoller(async (h) => {
    await advance(1000);
    const before = h.dispatched.length;
    h.respond = () => ({ ok: false, reason: 'hls-client' });
    await advance(60_000);
    assert.equal(h.dispatched.length, before, 'shouldUseLocal must not blank what hls.js reported');
  });
});

test('a network blip keeps the last known show on screen', async () => {
  await withPoller(async (h) => {
    await advance(1000);
    const before = h.dispatched.length;

    h.respond = () => new TypeError('Failed to fetch');
    await advance(120_000);

    assert.equal(h.dispatched.length, before, 'an outage is not an answer — do not blank the line');
  });
});

test('polling stops when the player stops', async () => {
  await withPoller(async (h) => {
    await advance(30_000);
    h.player.emit('stopped', {});
    const before = h.fetches.length;
    await advance(120_000);
    assert.equal(h.fetches.length, before);
  });
});

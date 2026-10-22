import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionGate } from '../src/ui/station-actions.js';

test('the last action wins when deferred resolutions finish out of order', async () => {
  const gate = createActionGate();
  const played = [];

  async function play(name, delay) {
    const token = gate.begin();
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (!gate.isCurrent(token)) return;
    played.push(name);
  }

  await Promise.all([play('first', 30), play('second', 5)]);
  assert.deepEqual(played, ['second']);
});

test('invalidate drops every pending action', async () => {
  const gate = createActionGate();
  const played = [];
  const token = gate.begin();
  gate.invalidate();
  await Promise.resolve();
  if (gate.isCurrent(token)) played.push('stale');
  assert.deepEqual(played, []);
});

test('begin returns a fresh token each time', () => {
  const gate = createActionGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.notEqual(first, second);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

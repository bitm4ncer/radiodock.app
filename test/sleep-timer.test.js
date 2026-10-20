import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLEEP_MAX_MINUTES,
  clampMinutes,
  minutesFromFraction,
  formatRemaining,
  createSleepTimerController,
} from '../src/ui/sleep-timer.js';

test('the sleep timer clamps to 0-90 minutes', () => {
  assert.equal(SLEEP_MAX_MINUTES, 90);
  assert.equal(clampMinutes(-5), 0);
  assert.equal(clampMinutes(0), 0);
  assert.equal(clampMinutes(42), 42);
  assert.equal(clampMinutes(120), 90);
  assert.equal(clampMinutes(Number.NaN), 0);
});

test('a pointer fraction maps to whole minutes across the full track', () => {
  assert.equal(minutesFromFraction(0), 0);
  assert.equal(minutesFromFraction(0.5), 45);
  assert.equal(minutesFromFraction(1), 90);
  assert.equal(minutesFromFraction(1.4), 90);
  assert.equal(minutesFromFraction(-0.2), 0);
});

test('the controller finishes exactly at the deadline', () => {
  let clock = 0;
  let finished = 0;
  const controller = createSleepTimerController({
    now: () => clock,
    onFinish: () => { finished += 1; },
  });

  controller.start(1);
  assert.equal(controller.state().active, true);
  assert.equal(controller.state().remainingMs, 60_000);

  clock = 30_000;
  controller.tick();
  assert.equal(controller.state().active, true);

  clock = 60_000;
  controller.tick();
  assert.equal(controller.state().active, false);
  assert.equal(controller.state().remainingMs, 0);
  assert.equal(finished, 1);
});

test('the remaining time counts down as m:ss and rounds up', () => {
  assert.equal(formatRemaining(0), '0:00');
  assert.equal(formatRemaining(59_000), '0:59');
  assert.equal(formatRemaining(60_000), '1:00');
  assert.equal(formatRemaining(61_500), '1:02');
  assert.equal(formatRemaining(90 * 60_000), '90:00');
});

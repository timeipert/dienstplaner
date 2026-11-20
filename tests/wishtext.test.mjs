// Tests for the short texts of day wishes (src/js/wishtext.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockString, EMPTY_DAY } from '../src/js/model.js';
import { describeDay, runsOf } from '../src/js/wishtext.js';

const H = 60;

test('runs: consecutive equal characters, in minutes', () => {
  const s = blockString(10 * H, 12 * H, 'x', blockString(18 * H, 19 * H + 30, '-'));
  assert.deepEqual(runsOf(s), [{ ch: 'x', from: 600, to: 720 }, { ch: '-', from: 1080, to: 1170 }]);
  assert.deepEqual(runsOf(EMPTY_DAY), []);
});

test('day texts: interval, start of the range, end of the range, whole day', () => {
  const range = [10 * H, 21 * H];
  const text = (eff, own) => describeDay(eff, own, range).map((d) => `${d.kind}:${d.text}`);
  assert.deepEqual(text(blockString(12 * H, 14 * H, 'x'), EMPTY_DAY), ['x:nicht 12–14']);
  assert.deepEqual(text(blockString(0, 16 * H + 30, 'x'), EMPTY_DAY), ['x:nicht bis 16:30']);
  assert.deepEqual(text(blockString(18 * H, 24 * H, 'x'), EMPTY_DAY), ['x:nicht ab 18']);
  assert.deepEqual(text('x'.repeat(48), EMPTY_DAY), ['x:ganzer Tag nicht']);
  assert.deepEqual(text(blockString(20 * H, 21 * H, '-'), EMPTY_DAY), ['-:eher nicht ab 20']);
  assert.deepEqual(text(blockString(14 * H, 17 * H, '+'), EMPTY_DAY), ['+:möchte 14–17']);
  assert.deepEqual(text(EMPTY_DAY, EMPTY_DAY), []);
});

test('day texts: exceptions ("can work") come from the own entries and are ordered by time', () => {
  const eff = blockString(8 * H, 12 * H, 'x');
  const own = blockString(14 * H, 15 * H, 'o');
  assert.deepEqual(describeDay(eff, own, [8 * H, 21 * H]).map((d) => d.text), ['nicht bis 12', 'frei 14–15']);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExportRange,
  inferExportRangePreset,
  normalizeExportRange,
} from '../src/lib/exportRange';

const referenceDate = new Date('2026-05-24T12:00:00');

test('buildExportRange returns the local day for today', () => {
  const range = buildExportRange('today', referenceDate);
  assert.deepEqual(range, { start: '2026-05-24', end: '2026-05-24' });
});

test('buildExportRange uses Monday to Sunday for this week', () => {
  const range = buildExportRange('this_week', referenceDate);
  assert.deepEqual(range, { start: '2026-05-18', end: '2026-05-24' });
});

test('buildExportRange keeps rolling windows inclusive', () => {
  assert.deepEqual(buildExportRange('last_7_days', referenceDate), {
    start: '2026-05-18',
    end: '2026-05-24',
  });
  assert.deepEqual(buildExportRange('last_30_days', referenceDate), {
    start: '2026-04-25',
    end: '2026-05-24',
  });
});

test('inferExportRangePreset recognizes the built-in presets', () => {
  const thursday = new Date('2026-05-21T12:00:00');
  const tuesday = new Date('2026-05-20T12:00:00');
  assert.equal(inferExportRangePreset(buildExportRange('today', thursday), thursday), 'today');
  assert.equal(inferExportRangePreset(buildExportRange('this_week', thursday), thursday), 'this_week');
  assert.equal(inferExportRangePreset(buildExportRange('last_7_days', tuesday), tuesday), 'last_7_days');
});

test('normalizeExportRange sorts the bounds', () => {
  assert.deepEqual(normalizeExportRange({ start: '2026-05-24', end: '2026-05-18' }), {
    start: '2026-05-18',
    end: '2026-05-24',
  });
});

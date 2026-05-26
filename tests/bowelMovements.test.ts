import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportRange } from '../src/lib/exportRange.ts';
import { buildBowelMovementCsv, buildBowelMovementFilename } from '../src/lib/bowelMovementExport.ts';
import type { BowelMovement } from '../src/lib/bowelMovements.ts';

test('this week export range uses Monday through Sunday in local time', () => {
  const range = buildExportRange('this_week', new Date('2026-05-26T12:00:00'));

  assert.equal(range.start, '2026-05-25');
  assert.equal(range.end, '2026-05-31');
});

test('bowel movement csv uses exact Date,Time,Notes columns and sorts ascending', () => {
  const entries: BowelMovement[] = [
    {
      id: '2',
      userId: 'user-1',
      occurredAt: '2026-05-26T12:15:00.000Z',
      notes: null,
    },
    {
      id: '1',
      userId: 'user-1',
      occurredAt: '2026-05-25T08:15:00.000Z',
      notes: 'Morning',
    },
  ];

  const csv = buildBowelMovementCsv(entries);
  const lines = csv.split('\n');

  assert.equal(lines[0], 'Date,Time,Notes');
  assert.equal(lines.length, 3);
  assert.equal(lines[1].startsWith('2026-05-25,'), true);
  assert.equal(lines[2].startsWith('2026-05-26,'), true);
  assert.equal(lines[1].split(',').length, 3);
  assert.equal(lines[2].split(',').length, 3);
  assert.equal(lines[1].endsWith(',Morning') || lines[1].endsWith('Morning'), true);
  assert.equal(lines[2].endsWith(','), true);
});

test('bowel movement csv filename uses the selected date range', () => {
  assert.equal(
    buildBowelMovementFilename('2026-05-01', '2026-05-31'),
    'fibertrack-bowel-movements-2026-05-01-to-2026-05-31.csv'
  );
});

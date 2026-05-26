import { format } from 'date-fns';
import { formatBowelMovementDate, formatBowelMovementTime, type BowelMovement } from './bowelMovements';

function escapeCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function buildBowelMovementCsv(entries: BowelMovement[]): string {
  const rows = [
    ['Date', 'Time', 'Notes'],
    ...entries
      .slice()
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((entry) => [
        formatBowelMovementDate(entry.occurredAt),
        formatBowelMovementTime(entry.occurredAt),
        entry.notes ?? '',
      ]),
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function buildBowelMovementFilename(start: string, end: string): string {
  return `fibertrack-bowel-movements-${start}-to-${end}.csv`;
}

export function formatBowelMovementExportRangeLabel(start: string, end: string): string {
  return `${format(new Date(`${start}T00:00:00`), 'MMM d, yyyy')} to ${format(new Date(`${end}T00:00:00`), 'MMM d, yyyy')}`;
}

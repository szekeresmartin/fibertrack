import { format, parseISO, startOfDay, endOfDay } from 'date-fns';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseLocalDateInput(dateInput: string | Date | undefined | null): Date | null {
  if (!dateInput) return null;

  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : new Date(dateInput);
  }

  const trimmed = dateInput.trim();
  if (!trimmed) return null;

  if (DATE_ONLY_PATTERN.test(trimmed)) {
    const parsed = parseISO(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = parseISO(trimmed);
  if (!isNaN(parsed.getTime())) return parsed;

  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Normalizes a database date string (e.g. ISO UTC) to a local YYYY-MM-DD string.
 * This ensures consistency across the dashboard, statistics, and weight table.
 */
export function normalizeDateToLocal(dateInput: string | Date | undefined | null): string {
  const parsed = parseLocalDateInput(dateInput);
  return parsed ? format(parsed, 'yyyy-MM-dd') : '';
}

/**
 * Returns the inclusive start/end timestamps for a local calendar day.
 * Use this for Supabase range boundaries when the user is working by local day.
 */
export function getLocalDayBounds(dateInput: string | Date | undefined | null): { start: Date; end: Date } {
  const parsed = parseLocalDateInput(dateInput) ?? new Date();
  return {
    start: startOfDay(parsed),
    end: endOfDay(parsed)
  };
}

/**
 * Compares two date inputs to see if they fall on the same local calendar day.
 */
export function isSameLocalDay(date1: string | Date | undefined | null, date2: string | Date | undefined | null): boolean {
  if (!date1 || !date2) return false;
  return normalizeDateToLocal(date1) === normalizeDateToLocal(date2);
}

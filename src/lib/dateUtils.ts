import { format, parseISO, isSameDay as isSameDayDateFns } from 'date-fns';

/**
 * Normalizes a database date string (e.g. ISO UTC) to a local YYYY-MM-DD string.
 * This ensures consistency across the dashboard, statistics, and weight table.
 */
export function normalizeDateToLocal(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return format(new Date(), 'yyyy-MM-dd');
  
  try {
    const d = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
    // Fallback if parseISO fails (e.g., malformed string)
    if (isNaN(d.getTime())) {
      return format(new Date(dateInput), 'yyyy-MM-dd');
    }
    return format(d, 'yyyy-MM-dd');
  } catch (e) {
    return format(new Date(), 'yyyy-MM-dd');
  }
}

/**
 * Compares two date inputs to see if they fall on the same local calendar day.
 */
export function isSameLocalDay(date1: string | Date | undefined | null, date2: string | Date | undefined | null): boolean {
  if (!date1 || !date2) return false;
  return normalizeDateToLocal(date1) === normalizeDateToLocal(date2);
}

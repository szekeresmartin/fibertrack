import { endOfWeek, startOfWeek, subDays } from 'date-fns';
import { normalizeDateToLocal } from './dateUtils';

export type ExportRangePreset = 'today' | 'this_week' | 'last_7_days' | 'last_30_days' | 'custom_range';

export interface ExportRange {
  start: string;
  end: string;
}

export const EXPORT_RANGE_LABELS: Record<ExportRangePreset, string> = {
  today: 'Today',
  this_week: 'This Week',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  custom_range: 'Custom Range',
};

export const EXPORT_RANGE_OPTIONS: Array<{ id: ExportRangePreset; label: string; helper: string }> = [
  { id: 'today', label: 'Today', helper: 'Current local day' },
  { id: 'this_week', label: 'This Week', helper: 'Monday to Sunday' },
  { id: 'last_7_days', label: 'Last 7 Days', helper: 'Rolling 7-day window' },
  { id: 'last_30_days', label: 'Last 30 Days', helper: 'Rolling 30-day window' },
  { id: 'custom_range', label: 'Custom Range', helper: 'Pick exact start and end dates' },
];

export function buildExportRange(preset: ExportRangePreset, referenceDate: Date = new Date()): ExportRange {
  const today = normalizeDateToLocal(referenceDate);

  if (preset === 'today') {
    return { start: today, end: today };
  }

  if (preset === 'this_week') {
    const start = startOfWeek(referenceDate, { weekStartsOn: 1 });
    const end = endOfWeek(referenceDate, { weekStartsOn: 1 });
    return {
      start: normalizeDateToLocal(start),
      end: normalizeDateToLocal(end),
    };
  }

  if (preset === 'last_7_days' || preset === 'last_30_days') {
    const days = preset === 'last_7_days' ? 7 : 30;
    const end = normalizeDateToLocal(referenceDate);
    const start = normalizeDateToLocal(subDays(referenceDate, days - 1));
    return { start, end };
  }

  return { start: today, end: today };
}

export function normalizeExportRange(range: ExportRange): ExportRange {
  return range.start <= range.end
    ? range
    : { start: range.end, end: range.start };
}

export function inferExportRangePreset(range: ExportRange, referenceDate: Date = new Date()): ExportRangePreset {
  const normalized = normalizeExportRange(range);
  const today = buildExportRange('today', referenceDate);
  if (normalized.start === today.start && normalized.end === today.end) {
    return 'today';
  }

  const thisWeek = buildExportRange('this_week', referenceDate);
  if (normalized.start === thisWeek.start && normalized.end === thisWeek.end) {
    return 'this_week';
  }

  const last7 = buildExportRange('last_7_days', referenceDate);
  if (normalized.start === last7.start && normalized.end === last7.end) {
    return 'last_7_days';
  }

  const last30 = buildExportRange('last_30_days', referenceDate);
  if (normalized.start === last30.start && normalized.end === last30.end) {
    return 'last_30_days';
  }

  return 'custom_range';
}

import { endOfDay, endOfMonth, startOfDay, startOfMonth, subDays } from 'date-fns';
import { Food, Meal } from '../types';
import { normalizeDateToLocal } from './dateUtils';
import {
  buildDailyIntakeFromMeals,
  buildWeightHubSeries,
  type ActivityDayTemplate,
  type DailyWeightActivityLog,
  type WeightHubDailyIntake,
  type WeightHubSeriesPoint,
} from './weightAnalytics';

export type WeightExportPeriod = '30d' | '3m' | '6m' | 'month';

export interface WeightExportRange {
  start: Date;
  end: Date;
}

export const WEIGHT_EXPORT_PERIOD_OPTIONS: Array<{ id: WeightExportPeriod; label: string }> = [
  { id: '30d', label: '30D' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: 'month', label: 'Current month' },
];

export function getWeightExportRange(period: WeightExportPeriod, referenceDate: Date = new Date()): WeightExportRange {
  const dayStart = startOfDay(referenceDate);
  const end = endOfDay(referenceDate);

  if (period === 'month') {
    return {
      start: startOfMonth(dayStart),
      end: endOfMonth(dayStart),
    };
  }

  const days = period === '30d' ? 30 : period === '3m' ? 90 : 180;
  return {
    start: subDays(dayStart, days - 1),
    end,
  };
}

export function buildWeightExportSeries(
  weightLogs: DailyWeightActivityLog[],
  dailyIntake: WeightHubDailyIntake[],
  templates: ActivityDayTemplate[],
  period: WeightExportPeriod,
  referenceDate: Date = new Date()
): WeightHubSeriesPoint[] {
  const range = getWeightExportRange(period, referenceDate);
  return buildWeightHubSeries(weightLogs, dailyIntake, templates, range.start, range.end);
}

export interface WeightTableExportInput {
  weightLogs: DailyWeightActivityLog[];
  meals: Meal[];
  foods: Food[];
  range: WeightExportRange;
  templates?: ActivityDayTemplate[];
}

export function buildWeightTableSeries({
  weightLogs,
  meals,
  foods,
  range,
  templates = [],
}: WeightTableExportInput): WeightHubSeriesPoint[] {
  const dailyIntake = buildDailyIntakeFromMeals(meals, foods);
  return buildWeightHubSeries(weightLogs, dailyIntake, templates, range.start, range.end);
}

export function buildWeightTableCsv(series: WeightHubSeriesPoint[]): string {
  const rows = [
    ['Date', 'Weight', 'Calories'],
    ...series.map((point) => [
      normalizeDateToLocal(point.date),
      point.weightKg === null || !Number.isFinite(point.weightKg) ? '' : point.weightKg.toFixed(1),
      point.calories === null || !Number.isFinite(point.calories) ? '' : Math.round(point.calories).toString(),
    ]),
  ];

  return rows.map((row) => row.join(',')).join('\n');
}

export function buildWeightTableCsvFromInput(input: WeightTableExportInput): string {
  return buildWeightTableCsv(buildWeightTableSeries(input));
}

export function buildWeightTableFilename(range: WeightExportRange): string {
  return `fibertrack-weight-table-${normalizeDateToLocal(range.start)}-to-${normalizeDateToLocal(range.end)}.csv`;
}

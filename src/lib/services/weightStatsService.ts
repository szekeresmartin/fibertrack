import { subDays } from 'date-fns';
import { calculateWeightTrend, calculateTDEE, WeightLog } from '../weightUtils';
import { parseLocalDateInput } from '../dateUtils';

export interface WeightStatsResult {
  tdee: number | null;
  weeklyTrend: number;
  trendDirection: 'up' | 'down' | 'stable';
  hasSufficientData: boolean;
  windowDays: number;
  windowLabel: string;
  weightLogCount: number;
  calorieDayCount: number;
}

function getWindowLabel(days: number): string {
  if (days >= 3650) return 'All Time';
  if (days === 30) return '30D';
  if (days === 90) return '3M';
  if (days === 180) return '6M';
  return `${days}D`;
}

function isWithinWindow(dateInput: string, days: number): boolean {
  const parsed = parseLocalDateInput(dateInput);
  if (!parsed) return false;

  const end = new Date();
  const start = subDays(end, Math.max(days - 1, 0));
  return parsed >= start && parsed <= end;
}

/**
 * Calculate weight stats using the exact active window selected in the UI.
 * No unrelated recent data is included.
 */
export function calculateWeightStats(
  weightLogs: WeightLog[], 
  dailyCalories: { date: string; calories: number; hasMeals?: boolean }[],
  days: number
): WeightStatsResult {
  const weightWindowLogs = weightLogs.filter(log => isWithinWindow(log.date, days));
  const calorieWindowDays = dailyCalories.filter(day => isWithinWindow(day.date, days));

  const weightLogCount = weightWindowLogs.length;
  const calorieDayCount = calorieWindowDays.filter(day => day.hasMeals).length;
  const hasSufficientData = weightLogCount >= 3 && calorieDayCount >= 3;
  const windowLabel = getWindowLabel(days);

  if (!hasSufficientData) {
    return {
      tdee: null,
      weeklyTrend: 0,
      trendDirection: 'stable',
      hasSufficientData: false,
      windowDays: days,
      windowLabel,
      weightLogCount,
      calorieDayCount
    };
  }

  const trend = calculateWeightTrend(weightWindowLogs, days);
  const tdee = calculateTDEE(weightWindowLogs, calorieWindowDays, days);

  return {
    tdee,
    weeklyTrend: trend.weeklyTrend,
    trendDirection: trend.direction,
    hasSufficientData: true,
    windowDays: days,
    windowLabel,
    weightLogCount,
    calorieDayCount
  };
}

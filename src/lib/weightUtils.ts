import { differenceInDays, subDays } from 'date-fns';

export interface WeightLog {
  date: string; // YYYY-MM-DD
  weight: number;
}

/**
 * Calculates the moving average for weight logs using a date-based window.
 * Returns null if the window contains fewer than 3 logs (optional safety, but strict 7-day window is requested).
 */
export function calculateMovingAverage(logs: WeightLog[], windowSizeDays: number = 7): (WeightLog & { movingAverage: number | null })[] {
  const sorted = [...logs]
    .map(log => ({ ...log, parsedDate: typeof log.date === 'string' ? new Date(log.date) : log.date }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((log, index) => {
    // Find all logs within the [date - windowSizeDays + 1, date] range
    const window = [];
    for (let i = index; i >= 0; i--) {
      const diff = differenceInDays(log.parsedDate, sorted[i].parsedDate);
      if (diff >= windowSizeDays) break;
      window.push(sorted[i]);
    }

    // Heuristic: only return average if we have at least 3 points in the 7-day window to avoid erratic lines
    if (window.length < 3) {
      return { date: log.date, weight: log.weight, movingAverage: null };
    }

    const sum = window.reduce((acc, curr) => acc + curr.weight, 0);
    return { date: log.date, weight: log.weight, movingAverage: sum / window.length };
  });
}

/**
 * Calculates the weight trend (kg/week) using linear regression.
 */
export function calculateWeightTrend(logs: WeightLog[], days: number = 30): { weeklyTrend: number; direction: 'up' | 'down' | 'stable' } {
  const sorted = [...logs]
    .map(log => ({ ...log, parsedDate: typeof log.date === 'string' ? new Date(log.date) : log.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  if (sorted.length < 3) {
    return { weeklyTrend: 0, direction: 'stable' };
  }

  const now = new Date();
  const cutoff = subDays(now, days);
  const activeWeights = sorted.filter(log => log.parsedDate >= cutoff);

  if (activeWeights.length < 3) {
    return { weeklyTrend: 0, direction: 'stable' };
  }

  const firstDate = activeWeights[0].parsedDate;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  const n = activeWeights.length;

  activeWeights.forEach(log => {
    const x = differenceInDays(log.parsedDate, firstDate);
    const y = log.weight;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });

  const denominator = (n * sumX2 - sumX * sumX);
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const weeklyTrend = slope * 7;

  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (weeklyTrend > 0.05) direction = 'up';
  else if (weeklyTrend < -0.05) direction = 'down';

  return { weeklyTrend, direction };
}

/**
 * Estimates Maintenance Calories (TDEE) based on weight trend and calorie intake.
 * Uses only available dailyCalories entries for the average.
 */
export function calculateTDEE(
  logs: WeightLog[], 
  dailyCalories: { date: string; calories: number }[],
  days: number = 30
): number | null {
  const { weeklyTrend } = calculateWeightTrend(logs, days);
  if (logs.length < 3 || dailyCalories.length < 3) return null;

  const totalCals = dailyCalories.reduce((sum, d) => sum + d.calories, 0);
  const avgDailyCalories = totalCals / dailyCalories.length;
  
  const dailySurplus = (weeklyTrend / 7) * 7700; // 1kg fat approx 7700 kcal
  const tdee = avgDailyCalories - dailySurplus;

  return tdee > 0 ? Math.round(tdee) : null;
}

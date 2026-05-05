import { calculateWeightTrend, calculateTDEE, WeightLog } from '../weightUtils';

export function calculateWeightStats(
  weightLogs: WeightLog[], 
  dailyCalories: { date: string; calories: number }[]
) {
  if (!weightLogs || weightLogs.length < 3) {
    return { tdee: null, weeklyTrend: 0, trendDirection: 'stable' as const };
  }

  const trend = calculateWeightTrend(weightLogs);
  const tdee = calculateTDEE(weightLogs, dailyCalories);

  return {
    tdee,
    weeklyTrend: trend.weeklyTrend,
    trendDirection: trend.direction
  };
}

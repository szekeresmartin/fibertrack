import { useMemo } from 'react';
import { WeightLog } from '../weightUtils';
import { Meal, Food } from '../../types';
import { calculateWeightStats } from '../services/weightStatsService';
import { buildDailyNutritionMap } from '../statsUtils';

export function useWeightStats(weightLogs: WeightLog[], meals: Meal[], foods: Food[]) {
  return useMemo(() => {
    const dailyCalories = Object.entries(buildDailyNutritionMap(meals, foods)).map(([date, metrics]) => ({
      date,
      calories: metrics.calories
    }));

    return calculateWeightStats(weightLogs, dailyCalories);
  }, [weightLogs, meals, foods]);
}

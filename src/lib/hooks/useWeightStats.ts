import { useMemo } from 'react';
import { format } from 'date-fns';
import { WeightLog } from '../weightUtils';
import { Meal, Food } from '../../types';
import { calculateWeightStats } from '../services/weightStatsService';
import { calculateMealTotals, getFoodOrUnknown } from '../utils';

export function useWeightStats(weightLogs: WeightLog[], meals: Meal[], foods: Food[]) {
  return useMemo(() => {
    // Group calories by day for TDEE calculation
    const dailyCalsMap: Record<string, number> = {};
    meals.forEach(meal => {
      const mealDateStr = format(new Date(meal.created_at || ''), 'yyyy-MM-dd');
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId || ''),
        quantity: item.quantityGrams,
        customMacros: item
      }));
      const totals = calculateMealTotals(mealItems);
      dailyCalsMap[mealDateStr] = (dailyCalsMap[mealDateStr] || 0) + totals.calories;
    });

    const dailyCalories = Object.entries(dailyCalsMap).map(([date, calories]) => ({ date, calories }));

    return calculateWeightStats(weightLogs, dailyCalories);
  }, [weightLogs, meals, foods]);
}

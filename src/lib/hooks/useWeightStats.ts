import { useMemo } from 'react';
import { WeightLog } from '../weightUtils';
import { Meal, Food } from '../../types';
import { calculateWeightStats } from '../services/weightStatsService';
import { buildCalendarDailySeries, buildDailyNutritionMap } from '../statsUtils';
import { startOfDay, subDays } from 'date-fns';

export function useWeightStats(weightLogs: WeightLog[], meals: Meal[], foods: Food[], days: number = 30) {
  return useMemo(() => {
    const dayGroups = buildDailyNutritionMap(meals, foods);
    const end = startOfDay(new Date());
    const start = subDays(end, Math.max(days - 1, 0));
    const calendarDays = buildCalendarDailySeries(start, end, dayGroups);

    const dailyCalories = calendarDays.map(day => ({
      date: day.date,
      calories: day.metrics.calories,
      hasMeals: day.hasMeals
    }));

    return calculateWeightStats(weightLogs, dailyCalories, days);
  }, [weightLogs, meals, foods, days]);
}

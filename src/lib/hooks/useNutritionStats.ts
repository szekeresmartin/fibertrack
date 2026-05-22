import { useMemo } from 'react';
import { subDays } from 'date-fns';
import { Meal, Food } from '../../types';
import { computeStats } from '../statsUtils';
import { normalizeDateToLocal } from '../dateUtils';

export function useNutritionStats(meals: Meal[], foods: Food[], days: number) {
  return useMemo(() => {
    const endDate = new Date();
    const startDate = subDays(endDate, days - 1);
    const start = normalizeDateToLocal(startDate);
    const end = normalizeDateToLocal(endDate);
    const rangeMeals = meals.filter(meal => {
      const key = normalizeDateToLocal(meal.created_at);
      if (!key) return false;
      return key >= start && key <= end;
    });
    const stats = computeStats(rangeMeals, foods, start, end);
    return { 
      dailyData: stats.dailyData.map(day => ({
        date: day.date,
        fiber: Number(day.metrics.fiber.toFixed(1)),
        gl: Number(day.metrics.gl.toFixed(1))
      })),
      mealDistData: stats.distributions,
      topFoodsData: stats.topSources.fiber.contribution,
      avgFiber: stats.aggregates.avgFiber,
      avgGL: stats.aggregates.avgGL,
      avgSugar: stats.aggregates.avgSugar,
      avgSaturatedFat: stats.aggregates.avgSaturatedFat
    };
  }, [meals, foods, days]);
}

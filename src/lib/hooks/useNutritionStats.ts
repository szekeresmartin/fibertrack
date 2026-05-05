import { useMemo } from 'react';
import { format, subDays, isSameDay } from 'date-fns';
import { Meal, Food } from '../../types';
import { calculateMealTotals, getFoodOrUnknown } from '../utils';

export function useNutritionStats(meals: Meal[], foods: Food[], days: number) {
  return useMemo(() => {
    // 1. Daily Trends
    const endDate = new Date();
    const dateRange = Array.from({ length: days }).map((_, i) => subDays(endDate, days - 1 - i));
    
    const dailyData = dateRange.map(date => {
      const dayMeals = meals.filter(meal => isSameDay(new Date(meal.created_at || ''), date));
      
      const totals = dayMeals.reduce((acc, meal) => {
        const mealItems = (meal.items || []).map(item => ({
          food: getFoodOrUnknown(foods, item.foodId),
          quantity: item.quantityGrams
        }));
        const mealTotals = calculateMealTotals(mealItems);
        return {
          total_fiber: acc.total_fiber + mealTotals.total_fiber,
          gl: acc.gl + mealTotals.gl
        };
      }, { total_fiber: 0, gl: 0 });

      return {
        date: format(date, 'MMM dd'),
        fiber: Number(totals.total_fiber.toFixed(1)),
        gl: Number(totals.gl.toFixed(1))
      };
    });

    // 2. Meal Distribution
    const mealDistMap: Record<string, number> = {};
    meals.forEach(meal => {
      const name = meal.name.trim() || 'Other';
      const normalizedName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId),
        quantity: item.quantityGrams
      }));
      const mealTotals = calculateMealTotals(mealItems);
      
      mealDistMap[normalizedName] = (mealDistMap[normalizedName] || 0) + mealTotals.total_fiber;
    });

    const mealDistData = Object.entries(mealDistMap)
      .map(([name, fiber]) => ({ name, fiber: Number(fiber.toFixed(1)) }))
      .sort((a, b) => b.fiber - a.fiber);

    // 3. Top Foods
    const foodFiberMap: Record<string, number> = {};
    meals.forEach(meal => {
      (meal.items || []).forEach(item => {
        const food = getFoodOrUnknown(foods, item.foodId);
        const fiberContribution = (food.total_fiber * item.quantityGrams) / 100;
        const foodName = food.name_hu || 'Unknown';
        foodFiberMap[foodName] = (foodFiberMap[foodName] || 0) + fiberContribution;
      });
    });

    const topFoodsData = Object.entries(foodFiberMap)
      .map(([name, fiber]) => ({ name, fiber: Number(fiber.toFixed(1)) }))
      .sort((a, b) => b.fiber - a.fiber)
      .slice(0, 5);

    // 4. Averages
    const avgFiber = dailyData.reduce((sum, d) => sum + d.fiber, 0) / days;
    const avgGL = dailyData.reduce((sum, d) => sum + d.gl, 0) / days;

    return { 
      dailyData, 
      mealDistData, 
      topFoodsData, 
      avgFiber, 
      avgGL
    };
  }, [meals, foods, days]);
}

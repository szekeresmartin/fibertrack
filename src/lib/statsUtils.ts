import { Meal, Food } from '../types';
import { calculateMealTotals, getFoodOrUnknown, isConservativeVegetable } from './utils';
import { normalizeDateToLocal } from './dateUtils';
import { 
  format, 
  eachDayOfInterval, 
  getISOWeek,
  differenceInDays,
} from 'date-fns';

export interface DailyMetrics {
  fiber: number;
  gl: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  solubleFiber: number;
  insolubleFiber: number;
  vegetableGrams: number;
}

interface DailyMetricsWithFlags extends DailyMetrics {
  ratioIsVisible: boolean;
  mealCount: number;
}

export interface CalendarDayData {
  date: string;
  metrics: DailyMetrics;
  hasMeals: boolean;
  mealCount: number;
}

export interface DayData {
  date: string; // YYYY-MM-DD or grouping label
  metrics: DailyMetrics;
  classification?: 'Optimal' | 'High GL' | 'Low Fiber';
}

export interface HighlightMeal {
  id: string;
  name: string;
  time: string;
  value: number;
  classification?: string;
  carbs?: number;
}

export interface ProcessedStats {
  range: { start: string; end: string };
  grouping: 'daily' | 'weekly' | 'monthly';
  dailyData: DayData[];
  calendarDailyData: CalendarDayData[];
  aggregates: {
    avgFiber: number;
    avgGL: number;
    avgCalories: number;
    avgProtein: number;
    avgCarbs: number;
    avgFat: number;
    totalMeals: number;
    activeDays: number;
    loggedDays: number;
    totalDays: number;
    coveragePercent: number;
    consistencyScore: number; // % of active days meeting target
    fiberToGLEfficiency: number;
    efficiencyLevel: 'Low' | 'Balanced' | 'Efficient';
    comparisons?: ComparisonData;
    fiberRatio: {
      soluble: number;
      insoluble: number;
      isVisible: boolean;
    } | null;
    vegDiversity: number;
    totalVegetableGrams: number;
  };
  distributions: { name: string; fiber: number }[];
  topSources: Record<string, {
    contribution: { name: string; value: number }[];
    frequency: { name: string; count: number }[];
  }>;
  vegStats: {
    name: string;
    count: number;
    grams: number;
  }[];
  highlights: {
    maxGLMeal: HighlightMeal | null;
    minFiberMeal: HighlightMeal | null;
    bestDay: { date: string, fiber: number, gl: number } | null;
    worstDay: { date: string, fiber: number, gl: number } | null;
  };
}

export interface ComparisonData {
  fiberDelta: number;
  fiberPercent: number | 'n/a';
  glDelta: number;
  glPercent: number | 'n/a';
  caloriesDelta: number;
  caloriesPercent: number | 'n/a';
}

export const computeStats = (
  meals: Meal[], 
  foods: Food[], 
  startStr: string, 
  endStr: string,
  prevAggregates?: ProcessedStats['aggregates']
): ProcessedStats => {
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T23:59:59`);
  const totalDays = differenceInDays(end, start) + 1;

  // 1. Grouping logic
  let grouping: 'daily' | 'weekly' | 'monthly' = 'daily';
  if (totalDays > 180) grouping = 'monthly';
  else if (totalDays > 60) grouping = 'weekly';

  // 2. Pre-aggregate by day (internal helper)
  const daysWithMeals = buildDailyNutritionMap(meals, foods);
  
  // 3. Process time-series data
  const timeSeries = buildTimeSeries(start, end, grouping, daysWithMeals);
  const calendarDailyData = buildCalendarDailySeries(start, end, daysWithMeals);

  // 4. Meal-level aggregates
  const distributions = calculateMealDistribution(meals, foods);
  const topSources = findTopSourcesForAllMetrics(meals, foods);
  const vegStats = calculateVegetableStats(meals, foods);
  const highlights = findHighlights(meals, foods);

  // 5. Global Aggregates
  const activeDaysCount = Object.keys(daysWithMeals).length;
  const daysMetTarget = calendarDailyData.filter(d => d.hasMeals && d.metrics.fiber >= 35).length;
  
  const hasDataQualityIssue = Object.values(daysWithMeals).some(d => d.ratioIsVisible === false);

  const totals = calendarDailyData.reduce<{
    fiber: number;
    gl: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    soluble: number;
    insoluble: number;
    vegetableGrams: number;
    hasDataQualityIssue: boolean;
  }>((acc, d) => ({
    fiber: acc.fiber + d.metrics.fiber,
    gl: acc.gl + d.metrics.gl,
    calories: acc.calories + d.metrics.calories,
    protein: acc.protein + d.metrics.protein,
    carbs: acc.carbs + d.metrics.carbs,
    fat: acc.fat + d.metrics.fat,
    soluble: acc.soluble + d.metrics.solubleFiber,
    insoluble: acc.insoluble + d.metrics.insolubleFiber,
    vegetableGrams: acc.vegetableGrams + d.metrics.vegetableGrams,
    hasDataQualityIssue: acc.hasDataQualityIssue
  }), { 
    fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0, soluble: 0, insoluble: 0, vegetableGrams: 0, 
    hasDataQualityIssue 
  });

  const fiberRatioVisible = totals.fiber > 0 && (totals.soluble + totals.insoluble) > 0 && !totals.hasDataQualityIssue;

  const loggedDays = activeDaysCount;
  const coveragePercent = totalDays > 0 ? Math.round((loggedDays / totalDays) * 100) : 0;
  const avgFiber = totalDays > 0 ? totals.fiber / totalDays : 0;
  const avgGL = totalDays > 0 ? totals.gl / totalDays : 0;
  const avgCalories = totalDays > 0 ? totals.calories / totalDays : 0;
  const avgProtein = totalDays > 0 ? totals.protein / totalDays : 0;
  const avgCarbs = totalDays > 0 ? totals.carbs / totalDays : 0;
  const avgFat = totalDays > 0 ? totals.fat / totalDays : 0;
  
  const efficiency = avgFiber / (avgGL + 1);
  let efficiencyLevel: 'Low' | 'Balanced' | 'Efficient' = 'Low';
  if (efficiency > 0.5) efficiencyLevel = 'Efficient';
  else if (efficiency > 0.2) efficiencyLevel = 'Balanced';

  const aggregates: ProcessedStats['aggregates'] = {
    avgFiber,
    avgGL,
    avgCalories,
    avgProtein,
    avgCarbs,
    avgFat,
    totalMeals: meals.length,
    activeDays: activeDaysCount,
    loggedDays,
    totalDays,
    coveragePercent,
    consistencyScore: totalDays > 0 ? Math.round((daysMetTarget / totalDays) * 100) : 0,
    fiberToGLEfficiency: efficiency,
    efficiencyLevel,
    fiberRatio: {
      soluble: totals.soluble,
      insoluble: totals.insoluble,
      isVisible: fiberRatioVisible
    },
    vegDiversity: vegStats.length,
    totalVegetableGrams: totals.vegetableGrams
  };

  // 6. Trend Comparison
  if (prevAggregates) {
    if (prevAggregates.loggedDays === 0) {
      return {
        range: { start: startStr, end: endStr },
        grouping,
        dailyData: timeSeries,
        calendarDailyData,
        aggregates,
        distributions,
        topSources,
        vegStats,
        highlights
      };
    }

    aggregates.comparisons = {
      fiberDelta: avgFiber - prevAggregates.avgFiber,
      fiberPercent: calculatePercentChange(prevAggregates.avgFiber, avgFiber),
      glDelta: avgGL - prevAggregates.avgGL,
      glPercent: calculatePercentChange(prevAggregates.avgGL, avgGL),
      caloriesDelta: avgCalories - prevAggregates.avgCalories,
      caloriesPercent: calculatePercentChange(prevAggregates.avgCalories, avgCalories)
    };
  }

  return {
    range: { start: startStr, end: endStr },
    grouping,
    dailyData: timeSeries,
    calendarDailyData,
    aggregates,
    distributions,
    topSources,
    vegStats,
    highlights
  };
};

/**
 * Groups and sums all metrics by local YYYY-MM-DD.
 */
export const buildDailyNutritionMap = (meals: Meal[], foods: Food[]): Record<string, DailyMetricsWithFlags> => {
  const dayGroups: Record<string, DailyMetricsWithFlags> = {};

  meals.forEach(meal => {
    const dateKey = normalizeDateToLocal(meal.created_at);
    if (!dateKey) return;
    if (!dayGroups[dateKey]) {
      dayGroups[dateKey] = { 
        fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0, 
        solubleFiber: 0, insolubleFiber: 0, vegetableGrams: 0,
        ratioIsVisible: true,
        mealCount: 0
      };
    }

    const mealItems = (meal.items || []).map(item => ({
      food: item.foodId ? getFoodOrUnknown(foods, item.foodId) : undefined,
      quantity: item.quantityGrams,
      customMacros: item
    }));
    const totals = calculateMealTotals(mealItems);
    dayGroups[dateKey].mealCount += 1;

    dayGroups[dateKey].fiber += totals.total_fiber;
    dayGroups[dateKey].gl += totals.gl;
    dayGroups[dateKey].calories += totals.calories;
    dayGroups[dateKey].protein += totals.protein;
    dayGroups[dateKey].carbs += totals.carbs;
    dayGroups[dateKey].fat += totals.fat;
    dayGroups[dateKey].solubleFiber += totals.soluble_fiber;
    dayGroups[dateKey].insolubleFiber += totals.insoluble_fiber;
    dayGroups[dateKey].vegetableGrams += totals.vegetable_grams;

    // Check for missing fiber ratio data
    mealItems.forEach(it => {
      if (it.food && it.food.total_fiber > 0 && it.food.soluble_fiber === 0 && it.food.insoluble_fiber === 0) {
        dayGroups[dateKey].ratioIsVisible = false;
      }
    });
  });

  return dayGroups;
};

/**
 * Builds a complete local calendar-day series for the selected range.
 * Missing days are included explicitly with zero metrics and hasMeals=false.
 */
export const buildCalendarDailySeries = (
  start: Date,
  end: Date,
  dayGroups: Record<string, DailyMetricsWithFlags>
): CalendarDayData[] => {
  return eachDayOfInterval({ start, end }).map(day => {
    const key = format(day, 'yyyy-MM-dd');
    const metrics = dayGroups[key];

    return {
      date: key,
      metrics: metrics ? {
        fiber: metrics.fiber,
        gl: metrics.gl,
        calories: metrics.calories,
        protein: metrics.protein,
        carbs: metrics.carbs,
        fat: metrics.fat,
        solubleFiber: metrics.solubleFiber,
        insolubleFiber: metrics.insolubleFiber,
        vegetableGrams: metrics.vegetableGrams
      } : {
        fiber: 0,
        gl: 0,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        solubleFiber: 0,
        insolubleFiber: 0,
        vegetableGrams: 0
      },
      hasMeals: !!metrics,
      mealCount: metrics?.mealCount ?? 0
    };
  });
};

/**
 * Builds the array for charts based on grouping
 */
const buildTimeSeries = (
  start: Date, 
  end: Date, 
  grouping: 'daily' | 'weekly' | 'monthly',
  dayGroups: Record<string, DailyMetricsWithFlags>
): DayData[] => {
  const result: DayData[] = [];
  const interval = eachDayOfInterval({ start, end });

  if (grouping === 'daily') {
    interval.forEach(day => {
      const key = format(day, 'yyyy-MM-dd');
      const metrics = dayGroups[key] || { 
        fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0,
        solubleFiber: 0, insolubleFiber: 0, vegetableGrams: 0,
        ratioIsVisible: true,
        mealCount: 0
      };
      
      let classification: DayData['classification'] = undefined;
      if (metrics.gl >= 100) classification = 'High GL';
      else if (metrics.fiber < 35 && metrics.fiber > 0) classification = 'Low Fiber';
      else if (metrics.fiber >= 35) classification = 'Optimal';

      result.push({
        date: format(day, 'MMM dd'),
        metrics,
        classification
      });
    });
  } else if (grouping === 'weekly') {
    // Group by ISO week
    const weekGroups: Record<string, DailyMetrics & { count: number }> = {};
    interval.forEach(day => {
      const weekKey = `${format(day, 'yyyy')}-W${getISOWeek(day).toString().padStart(2, '0')}`;
      if (!weekGroups[weekKey]) {
        weekGroups[weekKey] = { 
          fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0, 
          solubleFiber: 0, insolubleFiber: 0, vegetableGrams: 0, count: 0 
        } as any;
      }
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayMetrics = dayGroups[dayKey];
      if (dayMetrics) {
        weekGroups[weekKey].fiber += dayMetrics.fiber;
        weekGroups[weekKey].gl += dayMetrics.gl;
        weekGroups[weekKey].calories += dayMetrics.calories;
        weekGroups[weekKey].protein += dayMetrics.protein;
        weekGroups[weekKey].carbs += dayMetrics.carbs;
        weekGroups[weekKey].fat += dayMetrics.fat;
        weekGroups[weekKey].solubleFiber += dayMetrics.solubleFiber;
        weekGroups[weekKey].insolubleFiber += dayMetrics.insolubleFiber;
        weekGroups[weekKey].vegetableGrams += dayMetrics.vegetableGrams;
        weekGroups[weekKey].count++;
      }
    });

    Object.entries(weekGroups).forEach(([label, m]) => {
      result.push({
        date: label,
        metrics: {
          fiber: m.fiber / (m.count || 1),
          gl: m.gl / (m.count || 1),
          calories: m.calories / (m.count || 1),
          protein: m.protein / (m.count || 1),
          carbs: m.carbs / (m.count || 1),
          fat: m.fat / (m.count || 1),
          solubleFiber: m.solubleFiber / (m.count || 1),
          insolubleFiber: m.insolubleFiber / (m.count || 1),
          vegetableGrams: m.vegetableGrams / (m.count || 1)
        }
      });
    });
  } else {
    // Group by Month
    const monthGroups: Record<string, DailyMetrics & { count: number }> = {};
    interval.forEach(day => {
      const monthKey = format(day, 'yyyy-MM');
      if (!monthGroups[monthKey]) {
        monthGroups[monthKey] = { 
          fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0, 
          solubleFiber: 0, insolubleFiber: 0, vegetableGrams: 0, count: 0 
        } as any;
      }
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayMetrics = dayGroups[dayKey];
      if (dayMetrics) {
        monthGroups[monthKey].fiber += dayMetrics.fiber;
        monthGroups[monthKey].gl += dayMetrics.gl;
        monthGroups[monthKey].calories += dayMetrics.calories;
        monthGroups[monthKey].protein += dayMetrics.protein;
        monthGroups[monthKey].carbs += dayMetrics.carbs;
        monthGroups[monthKey].fat += dayMetrics.fat;
        monthGroups[monthKey].solubleFiber += dayMetrics.solubleFiber;
        monthGroups[monthKey].insolubleFiber += dayMetrics.insolubleFiber;
        monthGroups[monthKey].vegetableGrams += dayMetrics.vegetableGrams;
        monthGroups[monthKey].count++;
      }
    });

    Object.entries(monthGroups).forEach(([label, m]) => {
      result.push({
        date: label,
        metrics: {
          fiber: m.fiber / (m.count || 1),
          gl: m.gl / (m.count || 1),
          calories: m.calories / (m.count || 1),
          protein: m.protein / (m.count || 1),
          carbs: m.carbs / (m.count || 1),
          fat: m.fat / (m.count || 1),
          solubleFiber: m.solubleFiber / (m.count || 1),
          insolubleFiber: m.insolubleFiber / (m.count || 1),
          vegetableGrams: m.vegetableGrams / (m.count || 1)
        }
      });
    });
  }

  return result;
};

const calculateMealDistribution = (meals: Meal[], foods: Food[]) => {
  const dist: Record<string, number> = {};
  meals.forEach(meal => {
    const name = meal.name.trim() || 'Other';
    const normalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    
    const items = (meal.items || []).map(it => ({
      food: it.foodId ? getFoodOrUnknown(foods, it.foodId) : undefined,
      quantity: it.quantityGrams,
      customMacros: it
    }));
    const fiber = calculateMealTotals(items).total_fiber;
    dist[normalized] = (dist[normalized] || 0) + fiber;
  });

  return Object.entries(dist)
    .map(([name, fiber]) => ({ name, fiber: Number(fiber.toFixed(1)) }))
    .sort((a, b) => b.fiber - a.fiber);
};

const findTopSourcesForAllMetrics = (meals: Meal[], foods: Food[]) => {
  const metrics = ['fiber', 'calories', 'protein', 'carbs', 'fat'];
  const result: Record<string, any> = {};

  metrics.forEach(metric => {
    const contribution: Record<string, number> = {};
    const frequency: Record<string, Set<string>> = {};

    meals.forEach(meal => {
      (meal.items || []).forEach(item => {
        const food = item.foodId ? getFoodOrUnknown(foods, item.foodId) : null;
        const foodName = item.is_custom ? (item.name || 'Custom') : (food?.name_hu || 'Unknown');
        const factor = item.quantityGrams / 100;
        
        let value = 0;
        if (item.is_custom) {
          if (metric === 'calories') value = (item.calories || 0) * factor;
          else if (metric === 'protein') value = (item.protein || 0) * factor;
          else if (metric === 'carbs') value = (item.carbs || 0) * factor;
          else if (metric === 'fat') value = (item.fat || 0) * factor;
          else if (metric === 'fiber') value = 0; // Quick add doesn't support fiber yet
        } else if (food) {
          if (metric === 'fiber') value = (food.total_fiber * item.quantityGrams) / 100;
          else if (metric === 'calories') value = (food.calories * item.quantityGrams) / 100;
          else if (metric === 'protein') value = (food.protein * item.quantityGrams) / 100;
          else if (metric === 'carbs') value = (food.carbs * item.quantityGrams) / 100;
          else if (metric === 'fat') value = (food.fat * item.quantityGrams) / 100;
        }

        contribution[foodName] = (contribution[foodName] || 0) + value;
        if (!frequency[foodName]) frequency[foodName] = new Set();
        frequency[foodName].add(meal.id);
      });
    });

    result[metric] = {
      contribution: Object.entries(contribution)
        .map(([name, value]) => ({ name, value: Number(value.toFixed(1)) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      frequency: Object.entries(frequency)
        .map(([name, set]) => ({ name, count: set.size }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    };
  });

  return result;
};

const calculateVegetableStats = (meals: Meal[], foods: Food[]) => {
  const stats: Record<string, { count: number; grams: number }> = {};
  
  meals.forEach(meal => {
    (meal.items || []).forEach(item => {
      if (item.foodId) {
        const food = getFoodOrUnknown(foods, item.foodId);
        if (isConservativeVegetable(food)) {
          const name = food.name_hu || 'Unknown';
          if (!stats[name]) stats[name] = { count: 0, grams: 0 };
          stats[name].count += 1;
          stats[name].grams += item.quantityGrams;
        }
      }
    });
  });

  return Object.entries(stats)
    .map(([name, s]) => ({ name, count: s.count, grams: Math.round(s.grams) }))
    .sort((a, b) => b.count - a.count);
};

const findHighlights = (meals: Meal[], foods: Food[]): ProcessedStats['highlights'] => {
  if (meals.length === 0) return { maxGLMeal: null, minFiberMeal: null, bestDay: null, worstDay: null };

  let maxGL = -1;
  let maxGLMeal: HighlightMeal | null = null;
  
  let minFiber = Infinity;
  let minFiberMealRef: HighlightMeal | null = null;

  const dayGroups = buildDailyNutritionMap(meals, foods);
  
  let bestFiber = -1;
  let bestDayKey: string | null = null;
  
  let worstGL = -1;
  let worstDayKey: string | null = null;

  Object.entries(dayGroups).forEach(([date, metrics]) => {
    if (metrics.gl < 100 && metrics.fiber > bestFiber) {
      bestFiber = metrics.fiber;
      bestDayKey = date;
    }
    if (metrics.gl > worstGL) {
      worstGL = metrics.gl;
      worstDayKey = date;
    }
  });

  if (!bestDayKey && Object.keys(dayGroups).length > 0) {
    const sortedByFiber = Object.entries(dayGroups).sort((a,b) => b[1].fiber - a[1].fiber);
    bestDayKey = sortedByFiber[0][0];
  }

  meals.forEach(meal => {
    const items = (meal.items || []).map(it => ({
      food: it.foodId ? getFoodOrUnknown(foods, it.foodId) : undefined,
      quantity: it.quantityGrams,
      customMacros: it
    }));
    const totals = calculateMealTotals(items);

    if (totals.gl > maxGL) {
      maxGL = totals.gl;
      maxGLMeal = {
        id: meal.id,
        name: meal.name,
        time: meal.time,
        value: totals.gl,
        carbs: totals.carbs,
        classification: totals.gl >= 20 ? 'High GL' : totals.gl >= 10 ? 'Medium GL' : 'Low GL'
      };
    }

    if (totals.total_fiber < minFiber) {
      minFiber = totals.total_fiber;
      minFiberMealRef = {
        id: meal.id,
        name: meal.name,
        time: meal.time,
        value: totals.total_fiber
      };
    }
  });

  return { 
    maxGLMeal, 
    minFiberMeal: minFiberMealRef,
    bestDay: bestDayKey ? { date: bestDayKey, fiber: dayGroups[bestDayKey].fiber, gl: dayGroups[bestDayKey].gl } : null,
    worstDay: worstDayKey ? { date: worstDayKey, fiber: dayGroups[worstDayKey].fiber, gl: dayGroups[worstDayKey].gl } : null
  };
};

const calculatePercentChange = (prev: number, curr: number): number | 'n/a' => {
  if (prev === 0) return 'n/a';
  return Math.round(((curr - prev) / prev) * 100);
};

export const buildExportRows = (meals: Meal[], foods: Food[]): string[][] => {
  const headers = ['Date', 'Time', 'Meal', 'Food', 'Quantity(g)', 'Fiber', 'GL', 'Calories', 'Protein', 'Carbs', 'Fat'];
  const rows: string[][] = [headers];

  meals.forEach(meal => {
    const date = normalizeDateToLocal(meal.created_at);
    if (!date) return;
    (meal.items || []).forEach(item => {
      const food = item.foodId ? getFoodOrUnknown(foods, item.foodId) : null;
      const factor = item.quantityGrams / 100;
      
      const itemName = item.is_custom ? (item.name || 'Custom') : (food?.name_hu || 'Unknown');
      const itemFiber = item.is_custom ? 0 : ((food?.total_fiber || 0) * factor);
      const itemGL = item.is_custom ? 0 : ((food ? (food.gi * food.carbs * factor) / 100 : 0));
      const itemCals = item.is_custom ? (item.calories || 0) * factor : ((food?.calories || 0) * factor);
      const itemPro = item.is_custom ? (item.protein || 0) * factor : ((food?.protein || 0) * factor);
      const itemCarbs = item.is_custom ? (item.carbs || 0) * factor : ((food?.carbs || 0) * factor);
      const itemFat = item.is_custom ? (item.fat || 0) * factor : ((food?.fat || 0) * factor);

      rows.push([
        date,
        meal.time,
        meal.name,
        itemName,
        item.quantityGrams.toString(),
        itemFiber.toFixed(1),
        itemGL.toFixed(1),
        itemCals.toFixed(0),
        itemPro.toFixed(1),
        itemCarbs.toFixed(1),
        itemFat.toFixed(1)
      ]);
    });
  });

  return rows;
};

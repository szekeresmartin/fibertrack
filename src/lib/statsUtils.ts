import { Meal, Food } from '../types';
import { calculateMealTotals, getFoodOrUnknown } from './utils';
import { 
  format, 
  parseISO, 
  startOfDay, 
  eachDayOfInterval, 
  isSameDay, 
  isSameWeek, 
  isSameMonth, 
  getISOWeek,
  differenceInDays,
  subDays,
  startOfISOWeek,
  startOfMonth
} from 'date-fns';

export interface DailyMetrics {
  fiber: number;
  gl: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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
  aggregates: {
    avgFiber: number;
    avgGL: number;
    avgCalories: number;
    totalMeals: number;
    activeDays: number;
    totalDays: number;
    consistencyScore: number; // % of active days meeting target
    fiberToGLEfficiency: number;
    efficiencyLevel: 'Low' | 'Balanced' | 'Efficient';
    comparisons?: ComparisonData;
  };
  distributions: { name: string; fiber: number }[];
  topSources: Record<string, {
    contribution: { name: string; value: number }[];
    frequency: { name: string; count: number }[];
  }>;
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
  const start = parseISO(startStr);
  const end = parseISO(endStr);
  const totalDays = differenceInDays(end, start) + 1;

  // 1. Grouping logic
  let grouping: 'daily' | 'weekly' | 'monthly' = 'daily';
  if (totalDays > 180) grouping = 'monthly';
  else if (totalDays > 60) grouping = 'weekly';

  // 2. Pre-aggregate by day (internal helper)
  const daysWithMeals = aggregateByDay(meals, foods);
  
  // 3. Process time-series data
  const timeSeries = buildTimeSeries(start, end, grouping, daysWithMeals);

  // 4. Meal-level aggregates
  const distributions = calculateMealDistribution(meals, foods);
  const topSources = findTopSourcesForAllMetrics(meals, foods);
  const highlights = findHighlights(meals, foods);

  // 5. Global Aggregates
  const activeDaysCount = Object.keys(daysWithMeals).length;
  const daysMetTarget = Object.values(daysWithMeals).filter(d => d.fiber >= 35).length;
  
  const totals = Object.values(daysWithMeals).reduce((acc, d) => ({
    fiber: acc.fiber + d.fiber,
    gl: acc.gl + d.gl,
    calories: acc.calories + d.calories,
  }), { fiber: 0, gl: 0, calories: 0 });

  const avgFiber = activeDaysCount > 0 ? totals.fiber / activeDaysCount : 0;
  const avgGL = activeDaysCount > 0 ? totals.gl / activeDaysCount : 0;
  const avgCalories = activeDaysCount > 0 ? totals.calories / activeDaysCount : 0;
  
  const efficiency = avgFiber / (avgGL + 1);
  let efficiencyLevel: 'Low' | 'Balanced' | 'Efficient' = 'Low';
  if (efficiency > 0.5) efficiencyLevel = 'Efficient';
  else if (efficiency > 0.2) efficiencyLevel = 'Balanced';

  const aggregates: ProcessedStats['aggregates'] = {
    avgFiber,
    avgGL,
    avgCalories,
    totalMeals: meals.length,
    activeDays: activeDaysCount,
    totalDays,
    consistencyScore: activeDaysCount > 0 ? Math.round((daysMetTarget / activeDaysCount) * 100) : 0,
    fiberToGLEfficiency: efficiency,
    efficiencyLevel
  };

  // 6. Trend Comparison
  if (prevAggregates) {
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
    aggregates,
    distributions,
    topSources,
    highlights
  };
};

/**
 * Groups and sums all metrics by YYYY-MM-DD
 */
const aggregateByDay = (meals: Meal[], foods: Food[]): Record<string, DailyMetrics> => {
  const dayGroups: Record<string, DailyMetrics> = {};

  meals.forEach(meal => {
    const dateKey = format(parseISO(meal.created_at || ''), 'yyyy-MM-dd');
    if (!dayGroups[dateKey]) {
      dayGroups[dateKey] = { fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0 };
    }

    const mealItems = (meal.items || []).map(item => ({
      food: getFoodOrUnknown(foods, item.foodId),
      quantity: item.quantityGrams
    }));
    const totals = calculateMealTotals(mealItems);

    dayGroups[dateKey].fiber += totals.total_fiber;
    dayGroups[dateKey].gl += totals.gl;
    dayGroups[dateKey].calories += totals.calories;
    dayGroups[dateKey].protein += totals.protein;
    dayGroups[dateKey].carbs += totals.carbs;
    dayGroups[dateKey].fat += totals.fat;
  });

  return dayGroups;
};

/**
 * Builds the array for charts based on grouping
 */
const buildTimeSeries = (
  start: Date, 
  end: Date, 
  grouping: 'daily' | 'weekly' | 'monthly',
  dayGroups: Record<string, DailyMetrics>
): DayData[] => {
  const result: DayData[] = [];
  const interval = eachDayOfInterval({ start, end });

  if (grouping === 'daily') {
    interval.forEach(day => {
      const key = format(day, 'yyyy-MM-dd');
      const metrics = dayGroups[key] || { fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0 };
      
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
        weekGroups[weekKey] = { fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
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
          fat: m.fat / (m.count || 1)
        }
      });
    });
  } else {
    // Group by Month
    const monthGroups: Record<string, DailyMetrics & { count: number }> = {};
    interval.forEach(day => {
      const monthKey = format(day, 'yyyy-MM');
      if (!monthGroups[monthKey]) {
        monthGroups[monthKey] = { fiber: 0, gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
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
          fat: m.fat / (m.count || 1)
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
      food: getFoodOrUnknown(foods, it.foodId),
      quantity: it.quantityGrams
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
        const food = getFoodOrUnknown(foods, item.foodId);
        const foodName = food.name_hu || 'Unknown';
        
        let value = 0;
        if (metric === 'fiber') value = (food.total_fiber * item.quantityGrams) / 100;
        else if (metric === 'calories') value = (food.calories * item.quantityGrams) / 100;
        else if (metric === 'protein') value = (food.protein * item.quantityGrams) / 100;
        else if (metric === 'carbs') value = (food.carbs * item.quantityGrams) / 100;
        else if (metric === 'fat') value = (food.fat * item.quantityGrams) / 100;

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

const findHighlights = (meals: Meal[], foods: Food[]): ProcessedStats['highlights'] => {
  if (meals.length === 0) return { maxGLMeal: null, minFiberMeal: null, bestDay: null, worstDay: null };

  let maxGL = -1;
  let maxGLMeal: HighlightMeal | null = null;
  
  let minFiber = Infinity;
  let minFiberMealRef: HighlightMeal | null = null;

  const dayGroups = aggregateByDay(meals, foods);
  
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
      food: getFoodOrUnknown(foods, it.foodId),
      quantity: it.quantityGrams
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
    const date = format(parseISO(meal.created_at || ''), 'yyyy-MM-dd');
    (meal.items || []).forEach(item => {
      const food = getFoodOrUnknown(foods, item.foodId);
      const factor = item.quantityGrams / 100;
      
      rows.push([
        date,
        meal.time,
        meal.name,
        food.name_hu,
        item.quantityGrams.toString(),
        (food.total_fiber * factor).toFixed(1),
        ((food.gi * food.carbs * factor) / 100).toFixed(1),
        (food.calories * factor).toFixed(0),
        (food.protein * factor).toFixed(1),
        (food.carbs * factor).toFixed(1),
        (food.fat * factor).toFixed(1)
      ]);
    });
  });

  return rows;
};

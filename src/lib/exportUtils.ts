import { Food, Meal } from '../types';
import { calculateItemGL, getFoodOrUnknown, calculateMealTotals } from './utils';
import { format, parseISO } from 'date-fns';

/**
 * Normalizes the daily data and triggers a CSV download.
 * Returns true if successful, false if no data was found.
 */
export const downloadDayAsCSV = (
  date: Date,
  meals: Meal[],
  foods: Food[]
): boolean => {
  if (!meals || meals.length === 0) {
    return false;
  }

  const dateStr = format(date, 'yyyy-MM-dd');
  const filename = `fibertrack-${dateStr}-meals.csv`;

  // CSV Headers
  const headers = [
    'date',
    'meal_id',
    'meal_time',
    'meal_name',
    'food_name',
    'grams',
    'calories',
    'protein',
    'carbs',
    'fat',
    'fiber',
    'soluble_fiber',
    'insoluble_fiber',
    'GI',
    'GL'
  ];

  const rows: string[][] = [headers];

  // Logic: Each row = one food item
  meals.forEach((meal) => {
    (meal.items || []).forEach((item) => {
      const isCustom = item.is_custom;
      const food = item.foodId ? getFoodOrUnknown(foods, item.foodId) : null;
      const factor = item.quantityGrams / 100;
      
      const calories = isCustom ? (item.calories || 0) * factor : ((food?.calories || 0) * factor);
      const protein = isCustom ? (item.protein || 0) * factor : ((food?.protein || 0) * factor);
      const carbs = isCustom ? (item.carbs || 0) * factor : ((food?.carbs || 0) * factor);
      const fat = isCustom ? (item.fat || 0) * factor : ((food?.fat || 0) * factor);
      const fiber = isCustom ? 0 : ((food?.total_fiber || 0) * factor);
      const solubleFiber = isCustom ? 0 : (((food?.soluble_fiber || 0) * factor));
      const insolubleFiber = isCustom ? 0 : (((food?.insoluble_fiber || 0) * factor));
      const gl = (isCustom || !food) ? 0 : calculateItemGL(food, item.quantityGrams);
      const gi = isCustom ? 0 : (food?.gi || 0);
      const itemName = isCustom ? (item.name || 'Custom') : (food?.name_hu || 'Unknown');

      const row = [
        dateStr,
        meal.id,
        meal.time,
        escapeCSV(meal.name),
        escapeCSV(itemName),
        item.quantityGrams.toString(),
        Math.round(calories).toString(),
        protein.toFixed(1),
        carbs.toFixed(1),
        fat.toFixed(1),
        fiber.toFixed(1),
        solubleFiber.toFixed(1),
        insolubleFiber.toFixed(1),
        gi.toString(),
        gl.toFixed(1)
      ];
      rows.push(row);
    });
  });

  const csvContent = rows.map(r => r.join(',')).join('\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return true;
};
/**
 * Generates a human-readable text summary of the day's intake.
 */
export const generateDaySummaryText = (
  date: Date,
  meals: Meal[],
  foods: Food[]
): string | null => {
  if (!meals || meals.length === 0) {
    return null;
  }

  const dateStr = format(date, 'yyyy.MM.dd');
  
  // Calculate daily totals by reusing the existing logic
  // We'll re-calculate here to keep exportUtils independent of App state structure
  const mealData = meals.map(meal => {
    const items = (meal.items || []).map(item => ({
      food: item.foodId ? getFoodOrUnknown(foods, item.foodId) : undefined,
      quantity: item.quantityGrams,
      customMacros: item
    }));
    return {
      meal,
      totals: calculateMealTotals(items),
      items
    };
  });

  const dailyTotals = mealData.reduce((acc, m) => ({
    fiber: acc.fiber + m.totals.total_fiber,
    soluble_fiber: acc.soluble_fiber + m.totals.soluble_fiber,
    insoluble_fiber: acc.insoluble_fiber + m.totals.insoluble_fiber,
    gl: acc.gl + m.totals.gl,
    calories: acc.calories + m.totals.calories,
    protein: acc.protein + m.totals.protein,
    carbs: acc.carbs + m.totals.carbs,
    fat: acc.fat + m.totals.fat,
  }), { 
    fiber: 0, soluble_fiber: 0, insoluble_fiber: 0, 
    gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0 
  });

  let text = `${dateStr}\n\n`;
  text += `Fiber: ${dailyTotals.fiber.toFixed(1)}g / 35g (sol: ${dailyTotals.soluble_fiber.toFixed(1)}g, insol: ${dailyTotals.insoluble_fiber.toFixed(1)}g)\n`;
  text += `GL: ${Math.round(dailyTotals.gl)}\n`;
  text += `Calories: ${Math.round(dailyTotals.calories)} kcal\n`;
  text += `Protein: ${dailyTotals.protein.toFixed(1)}g | Carbs: ${dailyTotals.carbs.toFixed(1)}g | Fat: ${dailyTotals.fat.toFixed(1)}g\n\n`;

  // Process meals sorted by time
  const sortedMealData = [...mealData].sort((a, b) => a.meal.time.localeCompare(b.meal.time));

  sortedMealData.forEach(({ meal, items }) => {
    text += `${meal.time} ${meal.name}\n`;
    
    items.forEach((it) => {
      const name = it.customMacros?.is_custom ? it.customMacros.name : it.food?.name_hu;
      text += `${name} (${it.quantity}g)\n`;
    });

    text += `\n`;
  });

  return text.trim();
};

/**
 * Generates a human-readable text summary for a range of dates.
 */
export const generateRangeSummaryText = (
  meals: Meal[],
  foods: Food[],
  range: { start: string, end: string }
): string => {
  if (!meals || meals.length === 0) {
    return `No data found for range: ${range.start} to ${range.end}`;
  }

  // Group meals by date
  const grouped: Record<string, Meal[]> = {};
  meals.forEach(m => {
    // meals have created_at as ISO string or something similar
    const d = format(parseISO(m.created_at || ''), 'yyyy.MM.dd');
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(m);
  });

  let text = `FiberTrack Export: ${range.start} to ${range.end}\n`;
  text += `==========================================\n\n`;

  // Sort dates
  const sortedDates = Object.keys(grouped).sort();

  sortedDates.forEach((dateStr, idx) => {
    const dayMeals = grouped[dateStr];
    
    // Reuse the logic from generateDaySummaryText but for a pre-grouped set of meals
    const mealData = dayMeals.map(meal => {
      const items = (meal.items || []).map(item => ({
        food: item.foodId ? getFoodOrUnknown(foods, item.foodId) : undefined,
        quantity: item.quantityGrams,
        customMacros: item
      }));
      return {
        meal,
        totals: calculateMealTotals(items),
        items
      };
    });

    const dailyTotals = mealData.reduce((acc, m) => ({
      fiber: acc.fiber + m.totals.total_fiber,
      soluble_fiber: acc.soluble_fiber + m.totals.soluble_fiber,
      insoluble_fiber: acc.insoluble_fiber + m.totals.insoluble_fiber,
      gl: acc.gl + m.totals.gl,
      calories: acc.calories + m.totals.calories,
      protein: acc.protein + m.totals.protein,
      carbs: acc.carbs + m.totals.carbs,
      fat: acc.fat + m.totals.fat,
    }), { 
      fiber: 0, soluble_fiber: 0, insoluble_fiber: 0, 
      gl: 0, calories: 0, protein: 0, carbs: 0, fat: 0 
    });

    text += `${dateStr}\n\n`;
    text += `Fiber: ${dailyTotals.fiber.toFixed(1)}g / 35g (sol: ${dailyTotals.soluble_fiber.toFixed(1)}g, insol: ${dailyTotals.insoluble_fiber.toFixed(1)}g)\n`;
    text += `GL: ${Math.round(dailyTotals.gl)}\n`;
    text += `Calories: ${Math.round(dailyTotals.calories)} kcal\n`;
    text += `Protein: ${dailyTotals.protein.toFixed(1)}g | Carbs: ${dailyTotals.carbs.toFixed(1)}g | Fat: ${dailyTotals.fat.toFixed(1)}g\n\n`;

    // Process meals sorted by time
    const sortedMealData = [...mealData].sort((a, b) => a.meal.time.localeCompare(b.meal.time));

    sortedMealData.forEach(({ meal, items }) => {
      text += `${meal.time} ${meal.name}\n`;
      items.forEach((it) => {
        const name = it.customMacros?.is_custom ? it.customMacros.name : it.food?.name_hu;
        text += `  - ${name} (${it.quantity}g)\n`;
      });
      text += `\n`;
    });

    if (idx < sortedDates.length - 1) {
      text += `------------------------------------------\n\n`;
    }
  });

  return text.trim();
};

/**
 * Generates a clean text summary of the weekly plan.
 */
export const generateWeeklyPlanText = (
  weekRange: string,
  items: { name: string, grams: number }[],
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    total_fiber: number;
    vegetable_count: number;
  }
): string => {
  if (!items || items.length === 0) {
    return `Weekly Plan (${weekRange})\n\nNo planned items`;
  }

  let text = `Weekly Plan (Week: ${weekRange})\n\n`;
  text += `---\n\n`;

  items.forEach(item => {
    text += `${item.name} – ${item.grams}g\n`;
  });

  text += `\n---\n\n`;
  text += `Totals:\n\n`;
  text += `Calories: ${Math.round(totals.calories)} kcal\n`;
  text += `Protein: ${Math.round(totals.protein)} g\n`;
  text += `Carbs: ${Math.round(totals.carbs)} g\n`;
  text += `Fat: ${Math.round(totals.fat)} g\n`;
  text += `Fiber: ${totals.total_fiber.toFixed(1)} g\n`;
  text += `Vegetables: ${totals.vegetable_count}\n`;

  return text.trim();
};

/**
 * Escapes characters for CSV: wraps in quotes if it contains a comma or quote.
 */
function escapeCSV(val: string): string {
  if (!val) return '';
  const escaped = val.replace(/"/g, '""');
  if (escaped.includes(',') || escaped.includes('"')) {
    return `"${escaped}"`;
  }
  return escaped;
}

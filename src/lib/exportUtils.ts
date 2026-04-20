import { Food, Meal } from '../types';
import { calculateItemGL, getFoodOrUnknown, calculateMealTotals } from './utils';
import { format } from 'date-fns';

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
      const food = getFoodOrUnknown(foods, item.foodId);
      const factor = item.quantityGrams / 100;
      
      const calories = (food.calories * factor);
      const protein = (food.protein * factor);
      const carbs = (food.carbs * factor);
      const fat = (food.fat * factor);
      const fiber = (food.total_fiber * factor);
      const solubleFiber = ((food.soluble_fiber || 0) * factor);
      const insolubleFiber = ((food.insoluble_fiber || 0) * factor);
      const gl = calculateItemGL(food, item.quantityGrams);

      const row = [
        dateStr,
        meal.id,
        meal.time,
        escapeCSV(meal.name),
        escapeCSV(food.name_hu),
        item.quantityGrams.toString(),
        Math.round(calories).toString(),
        protein.toFixed(1),
        carbs.toFixed(1),
        fat.toFixed(1),
        fiber.toFixed(1),
        solubleFiber.toFixed(1),
        insolubleFiber.toFixed(1),
        (food.gi || 0).toString(),
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
      food: getFoodOrUnknown(foods, item.foodId),
      quantity: item.quantityGrams
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
    
    items.forEach(({ food, quantity }) => {
      text += `${food.name_hu} (${quantity}g)\n`;
    });

    text += `\n`;
  });

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

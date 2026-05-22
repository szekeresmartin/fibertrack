import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Food, MealItem } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(time: string) {
  return time; // Simple for now, assuming HH:mm
}

export function getFriendlyErrorMessage(err: unknown): string {
  if (!err) return 'Something went wrong. Please try again.';
  
  const msg = err instanceof Error ? err.message : 
              (typeof err === 'object' && err !== null && 'message' in err) ? String((err as any).message) : 
              String(err);
              
  const lowerMsg = msg.toLowerCase();
  
  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('network error') || lowerMsg.includes('offline')) {
    return 'No internet connection. Please try again.';
  }
  
  if (lowerMsg.includes('invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }

  // Generic fallback hides raw technical details
  return 'Something went wrong. Please try again.';
}

export function getGlycemicLoadLabel(gl: number): { label: string; color: string } {
  if (gl < 10.5) return { label: 'Low', color: 'text-green-600' };
  if (gl < 19.5) return { label: 'Medium', color: 'text-yellow-600' };
  return { label: 'High', color: 'text-red-500' };
}

export function calculateItemGL(food: Food, quantity: number): number {
  const gi = food.gi || 0;
  const carbs = food.carbs || 0;
  // Formula: GL = (gi * carbs * quantityGrams) / 10000
  return (gi * carbs * quantity) / 10000;
}

export function isConservativeVegetable(food: Food): boolean {
  if (!food) return false;
  if (food.category !== 'vegetable') return false;

  const text = `${food.name_hu || ''} ${food.name_en || ''} ${food.brand || ''}`.toLowerCase();
  const obviousFalsePositives = [
    'bread',
    'pizza',
    'pasta',
    'rice',
    'pastry',
    'pastries',
    'cake',
    'cookie',
    'snack',
    'chips',
    'crisps',
    'sauce',
    'soup',
    'mixed',
    'processed',
    'sandwich',
    'wrap',
    'burger',
    'ketchup',
    'mayo',
    'mayonnaise'
  ];

  return !obviousFalsePositives.some(term => text.includes(term));
}

export function calculateMealTotals(items: { food?: Food; quantity: number; customMacros?: Partial<MealItem> }[]) {
  return items.reduce(
    (acc, item) => {
      const factor = item.quantity / 100;
      
      // Prioritize custom macros if available (Quick Add)
      if (item.customMacros?.is_custom) {
        const totalFiber = item.customMacros.total_fiber ?? item.customMacros.fiber ?? 0;
        const solubleFiber = item.customMacros.soluble_fiber ?? 0;
        const insolubleFiber = item.customMacros.insoluble_fiber ?? 0;
        const sugar = item.customMacros.sugar ?? 0;
        const saturatedFat = item.customMacros.saturated_fat ?? 0;
        const gi = item.customMacros.gi ?? 0;
        const carbs = item.customMacros.carbs || 0;
        return {
          calories: acc.calories + (item.customMacros.calories || 0) * factor,
          carbs: acc.carbs + carbs * factor,
          protein: acc.protein + (item.customMacros.protein || 0) * factor,
          fat: acc.fat + (item.customMacros.fat || 0) * factor,
          sugar: acc.sugar + sugar * factor,
          saturated_fat: acc.saturated_fat + saturatedFat * factor,
          soluble_fiber: acc.soluble_fiber + solubleFiber * factor,
          insoluble_fiber: acc.insoluble_fiber + insolubleFiber * factor,
          total_fiber: acc.total_fiber + totalFiber * factor,
          gl: acc.gl + ((gi * carbs * item.quantity) / 10000),
          vegetable_grams: acc.vegetable_grams + 0,
        };
      }

      // Standard food logic
      let foodToUse = item.food;
      
      // Fallback to joinedFood if primary food lookup failed (Unknown) or is missing
      if ((!foodToUse || foodToUse.id === 'unknown' || foodToUse.id === item.customMacros?.foodId) && item.customMacros?.joinedFood) {
        foodToUse = item.customMacros.joinedFood;
      }

      if (!foodToUse || (foodToUse.id === 'unknown' && !item.customMacros?.is_custom)) {
        // If still unknown and not custom, we might show 0 or the unknown object
        if (!foodToUse) return acc;
      }
      
      const itemGL = calculateItemGL(foodToUse, item.quantity);
      const isVegetable = isConservativeVegetable(foodToUse);

      return {
        calories: acc.calories + (foodToUse.calories || 0) * factor,
        carbs: acc.carbs + (foodToUse.carbs || 0) * factor,
        protein: acc.protein + (foodToUse.protein || 0) * factor,
        fat: acc.fat + (foodToUse.fat || 0) * factor,
        sugar: acc.sugar + (foodToUse.sugar || 0) * factor,
        saturated_fat: acc.saturated_fat + (foodToUse.saturated_fat || 0) * factor,
        soluble_fiber: acc.soluble_fiber + (foodToUse.soluble_fiber || 0) * factor,
        insoluble_fiber: acc.insoluble_fiber + (foodToUse.insoluble_fiber || 0) * factor,
        total_fiber: acc.total_fiber + (foodToUse.total_fiber || 0) * factor,
        gl: acc.gl + itemGL,
        vegetable_grams: acc.vegetable_grams + (isVegetable ? item.quantity : 0),
      };
    },
    {
      calories: 0,
      carbs: 0,
      protein: 0,
      fat: 0,
      sugar: 0,
      saturated_fat: 0,
      soluble_fiber: 0,
      insoluble_fiber: 0,
      total_fiber: 0,
      gl: 0,
      vegetable_grams: 0,
    }
  );
}

export const getFoodOrUnknown = (foods: Food[], id: string): Food => {
  return foods.find(f => f.id === id) || {
    id,
    name_hu: 'Unknown',
    name_en: '',
    calories: 0, carbs: 0, protein: 0, fat: 0, sugar: 0, saturated_fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0,
    gi: 0,
    source: 'local',
    isDeleted: true
  };
};

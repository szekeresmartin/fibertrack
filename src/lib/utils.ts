import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Food } from '../types';

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

export function calculateMealTotals(items: { food: Food; quantity: number }[]) {
  return items.reduce(
    (acc, item) => {
      const factor = item.quantity / 100;
      const itemGL = calculateItemGL(item.food, item.quantity);
      const isVegetable = item.food.category === 'vegetable';

      return {
        calories: acc.calories + item.food.calories * factor,
        carbs: acc.carbs + item.food.carbs * factor,
        protein: acc.protein + item.food.protein * factor,
        fat: acc.fat + item.food.fat * factor,
        soluble_fiber: acc.soluble_fiber + item.food.soluble_fiber * factor,
        insoluble_fiber: acc.insoluble_fiber + item.food.insoluble_fiber * factor,
        total_fiber: acc.total_fiber + item.food.total_fiber * factor,
        gl: acc.gl + itemGL,
        vegetable_grams: acc.vegetable_grams + (isVegetable ? item.quantity : 0),
      };
    },
    {
      calories: 0,
      carbs: 0,
      protein: 0,
      fat: 0,
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
    calories: 0, carbs: 0, protein: 0, fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0,
    gi: 0,
    source: 'local',
    isDeleted: true
  };
};

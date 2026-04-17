import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Food } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(time: string) {
  return time; // Simple for now, assuming HH:mm
}

export function calculateMealTotals(items: { food: Food; quantity: number }[]) {
  return items.reduce(
    (acc, item) => {
      const factor = item.quantity / 100;
      return {
        calories: acc.calories + item.food.calories * factor,
        carbs: acc.carbs + item.food.carbs * factor,
        protein: acc.protein + item.food.protein * factor,
        fat: acc.fat + item.food.fat * factor,
        soluble_fiber: acc.soluble_fiber + item.food.soluble_fiber * factor,
        insoluble_fiber: acc.insoluble_fiber + item.food.insoluble_fiber * factor,
        total_fiber: acc.total_fiber + item.food.total_fiber * factor,
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
    }
  );
}

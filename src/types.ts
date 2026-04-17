export interface Food {
  id: string;
  name: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  soluble_fiber: number;
  insoluble_fiber: number;
  total_fiber: number;
  source: 'sheets' | 'local';
  isDeleted?: boolean;
}

export interface MealItem {
  foodId: string;
  quantityGrams: number;
}

export interface Meal {
  id: string;
  name: string;
  time: string; // ISO string or "HH:mm"
  items: MealItem[];
}

export interface DailyTotals {
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  soluble_fiber: number;
  insoluble_fiber: number;
  total_fiber: number;
}

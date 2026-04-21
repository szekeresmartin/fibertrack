export interface Food {
  id: string;
  name_hu: string;
  name_en?: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  soluble_fiber: number;
  insoluble_fiber: number;
  total_fiber: number;
  gi?: number;
  brand?: string;
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
  created_at?: string;
}

export interface DailyTotals {
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  soluble_fiber: number;
  insoluble_fiber: number;
  total_fiber: number;
  gl: number;
}

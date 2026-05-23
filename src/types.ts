export interface Food {
  id: string;
  name_hu: string;
  name_en?: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  sugar?: number | null;
  saturated_fat?: number | null;
  soluble_fiber: number;
  insoluble_fiber: number;
  total_fiber: number;
  sugar_source?: string | null;
  saturated_fat_source?: string | null;
  gi?: number;
  brand?: string;
  source: 'sheets' | 'local';
  isDeleted?: boolean;
  category?: 'vegetable' | 'other';
  is_vegetable?: boolean;
  is_fruit?: boolean;
  is_plant_based?: boolean;
  food_group?: string | null;
}

export interface MealItem {
  foodId: string | null;
  quantityGrams: number;
  // Custom item fields
  name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  sugar?: number | null;
  saturated_fat?: number | null;
  is_custom?: boolean;
  joinedFood?: Food | null;
  is_vegetable?: boolean;
  is_fruit?: boolean;
  is_plant_based?: boolean;
  food_group?: string | null;
  fiber?: number;
  total_fiber?: number;
  soluble_fiber?: number;
  insoluble_fiber?: number;
  gi?: number;
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
  sugar: number;
  saturated_fat: number;
  soluble_fiber: number;
  insoluble_fiber: number;
  total_fiber: number;
  gl: number;
  vegetable_grams: number;
}
export interface PlannedItem {
  id: string;
  foodId: string;
  quantityGrams: number;
}

export interface WeeklyPlan {
  id?: string;
  user_id: string;
  week_start: string; // ISO date string (YYYY-MM-DD)
  target_protein: number;
  target_carbs: number;
  target_fat: number;
  target_calories: number;
  target_fiber: number;
  target_vegetables: number;
  items: PlannedItem[];
}

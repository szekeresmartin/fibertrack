import { Food, Meal, MealItem } from '../types';

type RawMealItem = Record<string, any>;
type RawFoodRecord = Record<string, any>;
type RawMealRecord = Record<string, any> & {
  items?: RawMealItem[] | null;
  meal_items?: RawMealItem[] | null;
};

type MealWritePayload = {
  id?: string;
  user_id: string;
  name: string;
  time: string;
  created_at?: string;
};

type MealItemWritePayload = {
  meal_id: string;
  food_id: string | null;
  grams: number;
  name: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sugar: number | null;
  saturated_fat: number | null;
  total_fiber: number | null;
  soluble_fiber: number | null;
  insoluble_fiber: number | null;
  gi: number | null;
  is_custom: boolean;
};

function parseBooleanField(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === 'true') return true;
  if (value === false || value === 0 || value === 'false') return false;
  return undefined;
}

export function mapFoodRecord(rawFood: RawFoodRecord): Food {
  return {
    id: String(rawFood.id),
    name_hu: rawFood.name_hu ?? rawFood.name ?? 'Unknown Food',
    name_en: rawFood.name_en ?? undefined,
    calories: Number(rawFood.calories ?? 0),
    carbs: Number(rawFood.carbs ?? 0),
    protein: Number(rawFood.protein ?? 0),
    fat: Number(rawFood.fat ?? 0),
    sugar: rawFood.sugar ?? null,
    saturated_fat: rawFood.saturated_fat ?? null,
    soluble_fiber: Number(rawFood.soluble_fiber ?? 0),
    insoluble_fiber: Number(rawFood.insoluble_fiber ?? 0),
    total_fiber: Number(rawFood.total_fiber ?? 0),
    sugar_source: rawFood.sugar_source ?? null,
    saturated_fat_source: rawFood.saturated_fat_source ?? null,
    gi: rawFood.gi ?? undefined,
    brand: rawFood.brand ?? undefined,
    source: rawFood.source === 'sheets' ? 'sheets' : 'local',
    isDeleted: rawFood.isDeleted ?? undefined,
    category: rawFood.category ?? undefined,
    is_vegetable: parseBooleanField(rawFood.is_vegetable),
    is_fruit: parseBooleanField(rawFood.is_fruit),
    is_plant_based: parseBooleanField(rawFood.is_plant_based),
    food_group: rawFood.food_group ?? null,
  };
}

export function mapMealItem(raw: RawMealItem): MealItem {
  const totalFiber = raw.total_fiber ?? raw.fiber ?? null;
  const joinedFoodRaw = raw.food ?? raw.foods ?? raw.joinedFood ?? null;

  return {
    foodId: raw.food_id ?? raw.foodId ?? null,
    quantityGrams: Number(raw.grams ?? raw.quantityGrams ?? 0),
    is_custom: raw.is_custom ?? raw.isCustom ?? false,
    name: raw.name ?? undefined,
    calories: raw.calories ?? undefined,
    protein: raw.protein ?? undefined,
    carbs: raw.carbs ?? undefined,
    fat: raw.fat ?? undefined,
    sugar: raw.sugar ?? undefined,
    saturated_fat: raw.saturated_fat ?? undefined,
    fiber: totalFiber ?? undefined,
    total_fiber: totalFiber ?? undefined,
    soluble_fiber: raw.soluble_fiber ?? undefined,
    insoluble_fiber: raw.insoluble_fiber ?? undefined,
    gi: raw.gi ?? undefined,
    is_vegetable: parseBooleanField(raw.is_vegetable),
    is_fruit: parseBooleanField(raw.is_fruit),
    is_plant_based: parseBooleanField(raw.is_plant_based),
    food_group: raw.food_group ?? undefined,
    joinedFood: joinedFoodRaw ? mapFoodRecord(joinedFoodRaw) : null,
  };
}

export function mapMealRecord(rawMeal: RawMealRecord): Meal {
  const sourceItems = Array.isArray(rawMeal.items) && rawMeal.items.length > 0
    ? rawMeal.items
    : (rawMeal.meal_items || []);

  return {
    ...rawMeal,
    items: sourceItems.map(mapMealItem),
  } as Meal;
}

export function buildMealWritePayload(
  meal: Partial<Meal>,
  userId: string,
  createdAt?: string
): MealWritePayload {
  const payload: MealWritePayload = {
    user_id: userId,
    name: meal.name ?? '',
    time: meal.time ?? '',
  };

  if (meal.id) {
    payload.id = meal.id;
  }

  if (createdAt) {
    payload.created_at = createdAt;
  }

  return payload;
}

function pickFoodForMealItem(item: MealItem, foods: Food[]) {
  if (item.is_custom || !item.foodId) {
    return null;
  }

  return foods.find((food) => food.id === item.foodId) ?? null;
}

export function resolveMealItemFood(item: MealItem, foods: Food[]): Food | null {
  if (item.joinedFood) {
    return item.joinedFood;
  }

  if (!item.foodId) {
    return null;
  }

  return foods.find((food) => food.id === item.foodId) ?? null;
}

export function buildMealItemWritePayloads(
  mealId: string,
  items: MealItem[],
  foods: Food[]
): MealItemWritePayload[] {
  return items.map((item) => {
    const food = pickFoodForMealItem(item, foods);

    return {
      meal_id: mealId,
      food_id: item.is_custom ? null : item.foodId,
      grams: Number(item.quantityGrams) || 0,
      name: item.is_custom ? (item.name ?? null) : null,
      calories: item.is_custom ? (item.calories ?? null) : (food?.calories ?? null),
      protein: item.is_custom ? (item.protein ?? null) : (food?.protein ?? null),
      carbs: item.is_custom ? (item.carbs ?? null) : (food?.carbs ?? null),
      fat: item.is_custom ? (item.fat ?? null) : (food?.fat ?? null),
      sugar: item.is_custom ? (item.sugar ?? null) : (food?.sugar ?? null),
      saturated_fat: item.is_custom ? (item.saturated_fat ?? null) : (food?.saturated_fat ?? null),
      total_fiber: item.is_custom
        ? (item.total_fiber ?? item.fiber ?? null)
        : (food?.total_fiber ?? null),
      soluble_fiber: item.is_custom
        ? (item.soluble_fiber ?? null)
        : (food?.soluble_fiber ?? null),
      insoluble_fiber: item.is_custom
        ? (item.insoluble_fiber ?? null)
        : (food?.insoluble_fiber ?? null),
      gi: item.is_custom ? (item.gi ?? null) : (food?.gi ?? null),
      is_custom: !!item.is_custom,
    };
  });
}

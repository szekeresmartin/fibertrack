import { addDays, format, startOfWeek } from 'date-fns';
import { Food, Meal, PlannedMeal, PlannedMealItem, PlannedMealSlot } from '../types';

type NullableNumber = number | null | undefined;
type NullableBoolean = boolean | null | undefined;

export const PLANNED_MEAL_SLOTS: PlannedMealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

const MEAL_SLOT_LABELS: Record<PlannedMealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  other: 'Other',
};

const MEAL_SLOT_SHORT_LABELS: Record<PlannedMealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  other: 'Other',
};

export interface PlannedNutritionCell {
  value: number;
  reliable: boolean;
}

export interface PlannedNutritionTotals {
  calories: PlannedNutritionCell;
  protein: PlannedNutritionCell;
  carbs: PlannedNutritionCell;
  fat: PlannedNutritionCell;
  sugar: PlannedNutritionCell;
  saturated_fat: PlannedNutritionCell;
  total_fiber: PlannedNutritionCell;
  soluble_fiber: PlannedNutritionCell;
  insoluble_fiber: PlannedNutritionCell;
  gl: PlannedNutritionCell;
  vegetables_grams: PlannedNutritionCell;
  fruit_grams: PlannedNutritionCell;
  plant_based_grams: PlannedNutritionCell;
}

export interface PlannedMealInsertPayload {
  user_id: string;
  planned_date: string;
  meal_type: PlannedMealSlot;
  name: string | null;
  time: string | null;
}

export interface PlannedMealItemInsertPayload {
  planned_meal_id: string;
  food_id: string | null;
  custom_name: string | null;
  grams: number;
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
  gl: number | null;
  is_vegetable: boolean | null;
  is_fruit: boolean | null;
  is_plant_based: boolean | null;
  food_group: string | null;
}

export function getPlannedMealSlotLabel(slot: PlannedMealSlot): string {
  return MEAL_SLOT_LABELS[slot] ?? slot;
}

export function getPlannedMealSlotShortLabel(slot: PlannedMealSlot): string {
  return MEAL_SLOT_SHORT_LABELS[slot] ?? slot;
}

export function getMondayWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function formatLocalDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d')}`;
}

export function getMealSlotForActualMeal(meal: Meal): PlannedMealSlot {
  const text = `${meal.name || ''} ${meal.time || ''}`.toLowerCase();
  if (text.includes('breakfast') || text.includes('reggeli')) return 'breakfast';
  if (text.includes('lunch') || text.includes('ebed') || text.includes('ebéd')) return 'lunch';
  if (text.includes('dinner') || text.includes('vacsora')) return 'dinner';
  if (text.includes('snack') || text.includes('nasi')) return 'snack';

  const hour = Number((meal.time || '').split(':')[0]);
  if (Number.isFinite(hour)) {
    if (hour < 11) return 'breakfast';
    if (hour < 15) return 'lunch';
    if (hour < 17) return 'snack';
    return 'dinner';
  }

  return 'other';
}

function snapshotNumber(value: NullableNumber): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function snapshotBoolean(value: NullableBoolean): boolean | null {
  return value === null || value === undefined ? null : Boolean(value);
}

function snapshotText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function buildPlannedMealInsertPayload(
  userId: string,
  plannedDate: string,
  mealType: PlannedMealSlot,
  name?: string | null,
  time?: string | null
): PlannedMealInsertPayload {
  return {
    user_id: userId,
    planned_date: plannedDate,
    meal_type: mealType,
    name: snapshotText(name),
    time: snapshotText(time),
  };
}

export function buildPlannedMealItemInsertPayload(
  plannedMealId: string,
  food: Partial<Food> & Record<string, unknown>,
  grams: number,
  override?: { customName?: string | null }
): PlannedMealItemInsertPayload {
  const quantity = Number.isFinite(grams) ? Math.max(0, grams) : 0;
  const calories = snapshotNumber(food.calories);
  const protein = snapshotNumber(food.protein);
  const carbs = snapshotNumber(food.carbs);
  const fat = snapshotNumber(food.fat);
  const sugar = snapshotNumber(food.sugar ?? null);
  const saturatedFat = snapshotNumber(food.saturated_fat ?? null);
  const totalFiber = snapshotNumber(food.total_fiber ?? null);
  const solubleFiber = snapshotNumber(food.soluble_fiber ?? null);
  const insolubleFiber = snapshotNumber(food.insoluble_fiber ?? null);
  const gi = snapshotNumber(food.gi ?? null);
  const gl = gi !== null && carbs !== null ? (gi * carbs * quantity) / 10000 : null;

  return {
    planned_meal_id: plannedMealId,
    food_id: snapshotText(food.id),
    custom_name: snapshotText(override?.customName ?? food.name_hu ?? food.name ?? null),
    grams: quantity,
    calories,
    protein,
    carbs,
    fat,
    sugar,
    saturated_fat: saturatedFat,
    total_fiber: totalFiber,
    soluble_fiber: solubleFiber,
    insoluble_fiber: insolubleFiber,
    gi,
    gl,
    is_vegetable: snapshotBoolean(food.is_vegetable),
    is_fruit: snapshotBoolean(food.is_fruit),
    is_plant_based: snapshotBoolean(food.is_plant_based),
    food_group: snapshotText(food.food_group ?? null),
  };
}

export function buildPlannedMealItemInsertPayloadFromActualItem(
  plannedMealId: string,
  item: Partial<PlannedMealItem> & Record<string, unknown>,
  food?: Partial<Food> & Record<string, unknown> | null
): PlannedMealItemInsertPayload {
  const grams = Number(item.grams ?? item.quantityGrams ?? 0);
  const source = (food ?? item) as Partial<Food> & Record<string, unknown>;
  const customName = item.custom_name ?? source.name_hu ?? source.name ?? null;

  return buildPlannedMealItemInsertPayload(plannedMealId, source as any, grams, {
    customName: snapshotText(customName),
  });
}

export function mapPlannedMealItemRecord(rawItem: Record<string, unknown>): PlannedMealItem {
  return {
    id: String(rawItem.id),
    planned_meal_id: String(rawItem.planned_meal_id ?? rawItem.plan_id ?? ''),
    food_id: rawItem.food_id === null || rawItem.food_id === undefined ? null : String(rawItem.food_id),
    custom_name: snapshotText(rawItem.custom_name),
    grams: Number(rawItem.grams ?? 0),
    calories: snapshotNumber(rawItem.calories as NullableNumber),
    protein: snapshotNumber(rawItem.protein as NullableNumber),
    carbs: snapshotNumber(rawItem.carbs as NullableNumber),
    fat: snapshotNumber(rawItem.fat as NullableNumber),
    sugar: snapshotNumber(rawItem.sugar as NullableNumber),
    saturated_fat: snapshotNumber(rawItem.saturated_fat as NullableNumber),
    total_fiber: snapshotNumber(rawItem.total_fiber as NullableNumber),
    soluble_fiber: snapshotNumber(rawItem.soluble_fiber as NullableNumber),
    insoluble_fiber: snapshotNumber(rawItem.insoluble_fiber as NullableNumber),
    gi: snapshotNumber(rawItem.gi as NullableNumber),
    gl: snapshotNumber(rawItem.gl as NullableNumber),
    is_vegetable: snapshotBoolean(rawItem.is_vegetable as NullableBoolean),
    is_fruit: snapshotBoolean(rawItem.is_fruit as NullableBoolean),
    is_plant_based: snapshotBoolean(rawItem.is_plant_based as NullableBoolean),
    food_group: snapshotText(rawItem.food_group),
    created_at: snapshotText(rawItem.created_at),
    updated_at: snapshotText(rawItem.updated_at),
  };
}

export function mapPlannedMealRecord(rawMeal: Record<string, unknown>): PlannedMeal {
  const rawItems = Array.isArray(rawMeal.planned_meal_items)
    ? rawMeal.planned_meal_items
    : Array.isArray(rawMeal.items)
      ? rawMeal.items
      : [];

  return {
    id: String(rawMeal.id),
    user_id: String(rawMeal.user_id),
    planned_date: snapshotText(rawMeal.planned_date) ?? '',
    meal_type: rawMeal.meal_type as PlannedMealSlot,
    name: snapshotText(rawMeal.name),
    time: snapshotText(rawMeal.time),
    created_at: snapshotText(rawMeal.created_at),
    updated_at: snapshotText(rawMeal.updated_at),
    planned_meal_items: rawItems.map((item) => mapPlannedMealItemRecord(item as Record<string, unknown>)),
  };
}

function createEmptyCell(): PlannedNutritionCell {
  return {
    value: 0,
    reliable: true,
  };
}

function addCellValue(cell: PlannedNutritionCell, value: NullableNumber, gramsFactor: number): PlannedNutritionCell {
  if (value === null || value === undefined) {
    return { value: cell.value, reliable: false };
  }

  return {
    value: cell.value + Number(value) * gramsFactor,
    reliable: cell.reliable,
  };
}

function finalizeCell(cell: PlannedNutritionCell): PlannedNutritionCell {
  return {
    value: cell.value,
    reliable: cell.reliable,
  };
}

export function calculatePlannedMealTotals(items: PlannedMealItem[]): PlannedNutritionTotals {
  let calories = createEmptyCell();
  let protein = createEmptyCell();
  let carbs = createEmptyCell();
  let fat = createEmptyCell();
  let sugar = createEmptyCell();
  let saturatedFat = createEmptyCell();
  let totalFiber = createEmptyCell();
  let solubleFiber = createEmptyCell();
  let insolubleFiber = createEmptyCell();
  let gl = createEmptyCell();
  let vegetables = createEmptyCell();
  let fruit = createEmptyCell();
  let plantBased = createEmptyCell();

  items.forEach((item) => {
    const gramsFactor = Number(item.grams ?? 0) / 100;
    calories = addCellValue(calories, item.calories, gramsFactor);
    protein = addCellValue(protein, item.protein, gramsFactor);
    carbs = addCellValue(carbs, item.carbs, gramsFactor);
    fat = addCellValue(fat, item.fat, gramsFactor);
    sugar = addCellValue(sugar, item.sugar, gramsFactor);
    saturatedFat = addCellValue(saturatedFat, item.saturated_fat, gramsFactor);
    totalFiber = addCellValue(totalFiber, item.total_fiber, gramsFactor);
    solubleFiber = addCellValue(solubleFiber, item.soluble_fiber, gramsFactor);
    insolubleFiber = addCellValue(insolubleFiber, item.insoluble_fiber, gramsFactor);

    if (item.gi === null || item.gi === undefined || item.carbs === null || item.carbs === undefined) {
      gl = { value: gl.value, reliable: false };
    } else {
      gl = {
        value: gl.value + (Number(item.gi) * Number(item.carbs) * Number(item.grams ?? 0)) / 10000,
        reliable: gl.reliable,
      };
    }

    if (item.is_vegetable === null || item.is_vegetable === undefined) {
      vegetables = { value: vegetables.value, reliable: false };
    } else if (item.is_vegetable) {
      vegetables = {
        value: vegetables.value + Number(item.grams ?? 0),
        reliable: vegetables.reliable,
      };
    }

    if (item.is_fruit === null || item.is_fruit === undefined) {
      fruit = { value: fruit.value, reliable: false };
    } else if (item.is_fruit) {
      fruit = {
        value: fruit.value + Number(item.grams ?? 0),
        reliable: fruit.reliable,
      };
    }

    if (item.is_plant_based === null || item.is_plant_based === undefined) {
      plantBased = { value: plantBased.value, reliable: false };
    } else if (item.is_plant_based) {
      plantBased = {
        value: plantBased.value + Number(item.grams ?? 0),
        reliable: plantBased.reliable,
      };
    }
  });

  return {
    calories: finalizeCell(calories),
    protein: finalizeCell(protein),
    carbs: finalizeCell(carbs),
    fat: finalizeCell(fat),
    sugar: finalizeCell(sugar),
    saturated_fat: finalizeCell(saturatedFat),
    total_fiber: finalizeCell(totalFiber),
    soluble_fiber: finalizeCell(solubleFiber),
    insoluble_fiber: finalizeCell(insolubleFiber),
    gl: finalizeCell(gl),
    vegetables_grams: finalizeCell(vegetables),
    fruit_grams: finalizeCell(fruit),
    plant_based_grams: finalizeCell(plantBased),
  };
}

export function summarizePlannedMeals(meals: PlannedMeal[]): PlannedNutritionTotals {
  const allItems = meals.flatMap((meal) => meal.planned_meal_items || []);
  return calculatePlannedMealTotals(allItems);
}

export function countPlannedMealsForDay(meals: PlannedMeal[]): number {
  return meals.filter((meal) => (meal.planned_meal_items || []).length > 0).length;
}

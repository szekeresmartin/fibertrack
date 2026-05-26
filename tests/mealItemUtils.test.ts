import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMealItemWritePayloads } from '../src/lib/mealItemUtils.ts';
import type { Food, MealItem } from '../src/types.ts';

const baseFood: Food = {
  id: 'food-1',
  name_hu: 'Teszt étel',
  calories: 120,
  carbs: 20,
  protein: 8,
  fat: 4,
  sugar: 5,
  saturated_fat: 1,
  soluble_fiber: 2,
  insoluble_fiber: 3,
  total_fiber: 5,
  gi: 50,
  source: 'local',
};

test('buildMealItemWritePayloads strips source ids and preserves custom nutrition fields', () => {
  const customItem: MealItem & { id?: string } = {
    id: 'source-item-id',
    foodId: null,
    quantityGrams: 180,
    is_custom: true,
    name: 'Manual item',
    calories: 200,
    protein: 11,
    carbs: 18,
    fat: 7,
    sugar: 6,
    saturated_fat: 2,
    total_fiber: 4,
    soluble_fiber: 1.5,
    insoluble_fiber: 2.5,
    gi: 42,
    gl: 12.6,
  };

  const [payload] = buildMealItemWritePayloads('meal-1', [customItem], []);

  assert.equal((payload as Record<string, unknown>).id, undefined);
  assert.deepEqual(payload, {
    meal_id: 'meal-1',
    food_id: null,
    grams: 180,
    name: 'Manual item',
    calories: 200,
    protein: 11,
    carbs: 18,
    fat: 7,
    sugar: 6,
    saturated_fat: 2,
    total_fiber: 4,
    soluble_fiber: 1.5,
    insoluble_fiber: 2.5,
    gi: 42,
    is_custom: true,
  });
  assert.equal(Object.hasOwn(payload, 'gl'), false);
});

test('buildMealItemWritePayloads omits GL for copied food items and strips ids', () => {
  const foodItem: MealItem & { id?: string } = {
    id: 'source-item-id-2',
    foodId: 'food-1',
    quantityGrams: 150,
    is_custom: false,
  };

  const [payload] = buildMealItemWritePayloads('meal-2', [foodItem], [baseFood]);

  assert.equal((payload as Record<string, unknown>).id, undefined);
  assert.equal(payload.meal_id, 'meal-2');
  assert.equal(payload.food_id, 'food-1');
  assert.equal(payload.grams, 150);
  assert.equal(payload.calories, 120);
  assert.equal(payload.protein, 8);
  assert.equal(payload.carbs, 20);
  assert.equal(payload.fat, 4);
  assert.equal(payload.sugar, 5);
  assert.equal(payload.saturated_fat, 1);
  assert.equal(payload.total_fiber, 5);
  assert.equal(payload.soluble_fiber, 2);
  assert.equal(payload.insoluble_fiber, 3);
  assert.equal(payload.gi, 50);
  assert.equal(payload.is_custom, false);
  assert.equal(Object.hasOwn(payload, 'gl'), false);
});

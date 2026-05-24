import { endOfWeek, startOfWeek, subDays, differenceInCalendarDays } from 'date-fns';
import { Food, Meal, MealItem } from '../types';
import { normalizeDateToLocal } from './dateUtils';
import { resolveMealItemFood } from './mealItemUtils';

export type PlantIntakeMetricId = 'vegetables' | 'fruit' | 'plant_based';
export type PlantIntakeRangeId = 'today' | 'this_week' | 'last_7_days' | 'last_30_days' | 'custom_range';

export interface PlantIntakeRange {
  id: PlantIntakeRangeId;
  label: string;
  start: string;
  end: string;
  totalDays: number;
}

export interface PlantIntakeEntry {
  name: string;
  grams: number;
}

export interface PlantIntakeSummary {
  totalGrams: number;
  items: PlantIntakeEntry[];
}

interface PlantIntakeRangeInput {
  customStart?: string;
  customEnd?: string;
}

const PLANT_INTAKE_LABELS: Record<PlantIntakeRangeId, string> = {
  today: 'Today',
  this_week: 'This Week',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  custom_range: 'Custom Range',
};

function hasExplicitFlags(source: Partial<Pick<Food, 'is_vegetable' | 'is_fruit' | 'is_plant_based'>> | Partial<MealItem> | null | undefined) {
  return source?.is_vegetable !== undefined || source?.is_fruit !== undefined || source?.is_plant_based !== undefined;
}

function matchesMetric(source: Partial<Pick<Food, 'is_vegetable' | 'is_fruit' | 'is_plant_based'>> | Partial<MealItem> | null | undefined, metric: PlantIntakeMetricId): boolean {
  if (!source) return false;
  if (metric === 'vegetables') return source.is_vegetable === true;
  if (metric === 'fruit') return source.is_fruit === true;
  return source.is_plant_based === true;
}

function getClassificationSource(item: MealItem, foods: Food[]) {
  if (hasExplicitFlags(item.joinedFood)) {
    return item.joinedFood;
  }

  if (hasExplicitFlags(item)) {
    return item;
  }

  return resolveMealItemFood(item, foods);
}

export function buildPlantIntakeRange(
  rangeId: PlantIntakeRangeId,
  input: PlantIntakeRangeInput = {}
): PlantIntakeRange {
  const today = new Date();

  if (rangeId === 'today') {
    const todayStr = normalizeDateToLocal(today);
    return {
      id: rangeId,
      label: PLANT_INTAKE_LABELS[rangeId],
      start: todayStr,
      end: todayStr,
      totalDays: 1,
    };
  }

  if (rangeId === 'this_week') {
    const start = startOfWeek(today, { weekStartsOn: 1 });
    const end = endOfWeek(today, { weekStartsOn: 1 });
    return {
      id: rangeId,
      label: PLANT_INTAKE_LABELS[rangeId],
      start: normalizeDateToLocal(start),
      end: normalizeDateToLocal(end),
      totalDays: differenceInCalendarDays(end, start) + 1,
    };
  }

  if (rangeId === 'last_7_days' || rangeId === 'last_30_days') {
    const days = rangeId === 'last_7_days' ? 7 : 30;
    const end = today;
    const start = subDays(end, days - 1);
    return {
      id: rangeId,
      label: PLANT_INTAKE_LABELS[rangeId],
      start: normalizeDateToLocal(start),
      end: normalizeDateToLocal(end),
      totalDays: days,
    };
  }

  const start = input.customStart ? normalizeDateToLocal(input.customStart) : normalizeDateToLocal(today);
  const end = input.customEnd ? normalizeDateToLocal(input.customEnd) : start;
  const normalizedStart = start <= end ? start : end;
  const normalizedEnd = start <= end ? end : start;

  return {
    id: rangeId,
    label: PLANT_INTAKE_LABELS[rangeId],
    start: normalizedStart,
    end: normalizedEnd,
    totalDays: differenceInCalendarDays(
      new Date(`${normalizedEnd}T00:00:00`),
      new Date(`${normalizedStart}T00:00:00`)
    ) + 1,
  };
}

export function buildPlantIntakeSummary(
  meals: Meal[],
  foods: Food[],
  range: PlantIntakeRange,
  metric: PlantIntakeMetricId
): PlantIntakeSummary {
  const entries = new Map<string, { name: string; grams: number }>();
  let totalGrams = 0;

  meals.forEach(meal => {
    const dateKey = normalizeDateToLocal(meal.created_at);
    if (!dateKey || dateKey < range.start || dateKey > range.end) {
      return;
    }

    (meal.items || []).forEach(item => {
      const classificationSource = getClassificationSource(item, foods);
      if (!matchesMetric(classificationSource, metric)) {
        return;
      }

      const food = resolveMealItemFood(item, foods);
      const name = food?.name_hu || food?.name_en || item.name || 'Unknown';
      const grams = Number(item.quantityGrams) || 0;
      const key = food?.id ?? name;
      const current = entries.get(key) ?? { name, grams: 0 };
      current.grams += grams;
      entries.set(key, current);
      totalGrams += grams;
    });
  });

  return {
    totalGrams,
    items: Array.from(entries.values())
      .map(entry => ({
        name: entry.name,
        grams: Number(entry.grams.toFixed(1)),
      }))
      .sort((a, b) => b.grams - a.grams),
  };
}

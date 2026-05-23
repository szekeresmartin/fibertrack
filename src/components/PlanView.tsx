import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Copy,
  Sparkles,
  Leaf,
} from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { addDays, format } from 'date-fns';
import { Food, Meal, PlannedMeal, PlannedMealSlot } from '../types';
import { supabase } from '../lib/supabase';
import { getLocalDayBounds } from '../lib/dateUtils';
import { cn, isConservativeVegetable, getFoodOrUnknown } from '../lib/utils';
import {
  buildPlannedMealInsertPayload,
  buildPlannedMealItemInsertPayload,
  buildPlannedMealItemInsertPayloadFromActualItem,
  calculatePlannedMealTotals,
  countPlannedMealsForDay,
  formatLocalDate,
  formatWeekRange,
  getMealSlotForActualMeal,
  getMondayWeekStart,
  getPlannedMealSlotLabel,
  getPlannedMealSlotShortLabel,
  getWeekDates,
  mapPlannedMealRecord,
  PLANNED_MEAL_SLOTS,
  summarizePlannedMeals,
  type PlannedNutritionCell,
  type PlannedNutritionTotals,
} from '../lib/planning';
import { mapMealRecord } from '../lib/mealItemUtils';

interface PlanViewProps {
  foods: Food[];
  user: User;
}

function formatNutritionCell(cell: PlannedNutritionCell, fractionDigits = 0): string {
  if (!cell.reliable) return '—';
  return Number.isFinite(cell.value) ? cell.value.toFixed(fractionDigits) : '—';
}

function slotAccent(slot: PlannedMealSlot) {
  switch (slot) {
    case 'breakfast':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'lunch':
      return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'dinner':
      return 'bg-rose-50 text-rose-700 border-rose-100';
    case 'snack':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-100';
  }
}

function toMealItemDisplayName(item: Record<string, any>, food?: Food | null) {
  return item.custom_name || item.name || food?.name_hu || 'Unknown food';
}

function localDateForInput(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function createEmptyWeekMap() {
  return PLANNED_MEAL_SLOTS.reduce((acc, slot) => {
    acc[slot] = null;
    return acc;
  }, {} as Record<PlannedMealSlot, PlannedMeal | null>);
}

function averageTotals(dayTotals: PlannedNutritionTotals[]): PlannedNutritionTotals {
  const aggregate = dayTotals.reduce(
    (acc, totals) => {
      const add = (key: keyof PlannedNutritionTotals) => {
        const cell = totals[key];
        acc[key].value += cell.value;
        acc[key].reliable = acc[key].reliable && cell.reliable;
      };

      add('calories');
      add('protein');
      add('carbs');
      add('fat');
      add('sugar');
      add('saturated_fat');
      add('total_fiber');
      add('soluble_fiber');
      add('insoluble_fiber');
      add('gl');
      add('vegetables_grams');
      add('fruit_grams');
      add('plant_based_grams');
      return acc;
    },
    {
      calories: { value: 0, reliable: true },
      protein: { value: 0, reliable: true },
      carbs: { value: 0, reliable: true },
      fat: { value: 0, reliable: true },
      sugar: { value: 0, reliable: true },
      saturated_fat: { value: 0, reliable: true },
      total_fiber: { value: 0, reliable: true },
      soluble_fiber: { value: 0, reliable: true },
      insoluble_fiber: { value: 0, reliable: true },
      gl: { value: 0, reliable: true },
      vegetables_grams: { value: 0, reliable: true },
      fruit_grams: { value: 0, reliable: true },
      plant_based_grams: { value: 0, reliable: true },
    } as PlannedNutritionTotals
  );

  const divide = (cell: PlannedNutritionCell) => ({
    value: cell.value / 7,
    reliable: cell.reliable,
  });

  return {
    calories: divide(aggregate.calories),
    protein: divide(aggregate.protein),
    carbs: divide(aggregate.carbs),
    fat: divide(aggregate.fat),
    sugar: divide(aggregate.sugar),
    saturated_fat: divide(aggregate.saturated_fat),
    total_fiber: divide(aggregate.total_fiber),
    soluble_fiber: divide(aggregate.soluble_fiber),
    insoluble_fiber: divide(aggregate.insoluble_fiber),
    gl: divide(aggregate.gl),
    vegetables_grams: divide(aggregate.vegetables_grams),
    fruit_grams: divide(aggregate.fruit_grams),
    plant_based_grams: divide(aggregate.plant_based_grams),
  };
}

export default function PlanView({ foods, user }: PlanViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [weekStart, setWeekStart] = useState(() => getMondayWeekStart(new Date()));
  const [internalView, setInternalView] = useState<'day' | 'week'>('day');
  const [plannedMeals, setPlannedMeals] = useState<PlannedMeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<PlannedMealSlot>('breakfast');
  const [foodQuery, setFoodQuery] = useState('');
  const [isCopyingActual, setIsCopyingActual] = useState(false);

  const selectedDateStr = localDateForInput(selectedDate);
  const weekStartStr = localDateForInput(weekStart);
  const weekEndStr = localDateForInput(addDays(weekStart, 6));
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const loadWeekPlan = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: loadError } = await supabase
        .from('planned_meals')
        .select(`
          *,
          planned_meal_items (*)
        `)
        .eq('user_id', user.id)
        .gte('planned_date', weekStartStr)
        .lte('planned_date', weekEndStr);

      if (loadError) throw loadError;

      const mapped = (data || []).map((meal) => mapPlannedMealRecord(meal as Record<string, unknown>));
      mapped.sort((a, b) => {
        const dayDiff = a.planned_date.localeCompare(b.planned_date);
        if (dayDiff !== 0) return dayDiff;
        return PLANNED_MEAL_SLOTS.indexOf(a.meal_type) - PLANNED_MEAL_SLOTS.indexOf(b.meal_type);
      });
      setPlannedMeals(mapped);
    } catch (err) {
      console.error('Failed to load planned meals:', err);
      setError('Failed to load plan data.');
      setPlannedMeals([]);
    } finally {
      setIsLoading(false);
    }
  }, [user.id, weekStartStr, weekEndStr]);

  useEffect(() => {
    void loadWeekPlan();
  }, [loadWeekPlan]);

  const plannedMealsByDay = useMemo(() => {
    const grouped = weekDates.reduce((acc, date) => {
      acc[formatLocalDate(date)] = createEmptyWeekMap();
      return acc;
    }, {} as Record<string, Record<PlannedMealSlot, PlannedMeal | null>>);

    plannedMeals.forEach((meal) => {
      if (!grouped[meal.planned_date]) return;
      grouped[meal.planned_date][meal.meal_type] = meal;
    });

    return grouped;
  }, [plannedMeals, weekDates]);

  const selectedDayMeals = useMemo(() => {
    const slots = createEmptyWeekMap();
    plannedMeals
      .filter((meal) => meal.planned_date === selectedDateStr)
      .forEach((meal) => {
        slots[meal.meal_type] = meal;
      });
    return slots;
  }, [plannedMeals, selectedDateStr]);

  const selectedDayMealList = useMemo(
    () => Object.values(selectedDayMeals).filter(Boolean) as PlannedMeal[],
    [selectedDayMeals]
  );

  const selectedDayTotals = useMemo(
    () => summarizePlannedMeals(selectedDayMealList),
    [selectedDayMealList]
  );

  const weekDaySummaries = useMemo(() => {
    return weekDates.map((date) => {
      const dateStr = formatLocalDate(date);
      const meals = Object.values(plannedMealsByDay[dateStr] || {}).filter(Boolean) as PlannedMeal[];
      const totals = summarizePlannedMeals(meals);
      return {
        date,
        dateStr,
        meals,
        totals,
        plannedCount: countPlannedMealsForDay(meals),
      };
    });
  }, [plannedMealsByDay, weekDates]);

  const weekSummary = useMemo(
    () => averageTotals(weekDaySummaries.map((day) => day.totals)),
    [weekDaySummaries]
  );

  const filteredFoods = useMemo(() => {
    const query = foodQuery.trim().toLowerCase();
    const list = query
      ? foods.filter((food) => {
          const haystack = `${food.name_hu || ''} ${food.name_en || ''} ${food.brand || ''}`.toLowerCase();
          return haystack.includes(query);
        })
      : foods;

    return list.slice(0, 20);
  }, [foods, foodQuery]);

  const dayLabel = useMemo(() => format(selectedDate, 'EEE, MMM d'), [selectedDate]);

  function setDateAndWeek(date: Date) {
    setSelectedDate(date);
    setWeekStart(getMondayWeekStart(date));
  }

  async function ensurePlannedMeal(slot: PlannedMealSlot) {
    const existing = selectedDayMeals[slot];
    if (existing) return existing;

    const payload = buildPlannedMealInsertPayload(
      user.id,
      selectedDateStr,
      slot,
      getPlannedMealSlotLabel(slot),
      slot === 'breakfast' ? '08:00' : slot === 'lunch' ? '12:30' : slot === 'dinner' ? '18:00' : slot === 'snack' ? '15:30' : null
    );

    const { data, error: insertError } = await supabase
      .from('planned_meals')
      .insert(payload)
      .select(`
        *,
        planned_meal_items (*)
      `)
      .single();

    if (insertError) throw insertError;

    const created = mapPlannedMealRecord(data as Record<string, unknown>);
    setPlannedMeals((prev) => [...prev, created]);
    return created;
  }

  async function handleAddFood(slot: PlannedMealSlot, food: Food) {
    setIsSaving(true);
    setError(null);
    try {
      const meal = await ensurePlannedMeal(slot);
      const payload = buildPlannedMealItemInsertPayload(meal.id, food as any, 100);

      const { data, error: insertError } = await supabase
        .from('planned_meal_items')
        .insert(payload)
        .select()
        .single();

      if (insertError) throw insertError;

      const createdItem = {
        id: String(data.id),
        planned_meal_id: meal.id,
        food_id: payload.food_id,
        custom_name: payload.custom_name,
        grams: payload.grams,
        calories: payload.calories,
        protein: payload.protein,
        carbs: payload.carbs,
        fat: payload.fat,
        sugar: payload.sugar,
        saturated_fat: payload.saturated_fat,
        total_fiber: payload.total_fiber,
        soluble_fiber: payload.soluble_fiber,
        insoluble_fiber: payload.insoluble_fiber,
        gi: payload.gi,
        gl: payload.gl,
        is_vegetable: payload.is_vegetable,
        is_fruit: payload.is_fruit,
        is_plant_based: payload.is_plant_based,
        food_group: payload.food_group,
        created_at: data.created_at ?? null,
        updated_at: data.updated_at ?? null,
      };

      setPlannedMeals((prev) =>
        prev.map((entry) =>
          entry.id === meal.id
            ? { ...entry, planned_meal_items: [...entry.planned_meal_items, createdItem as any] }
            : entry
        )
      );
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to add planned food:', err);
      setError('Failed to add food to the plan.');
    } finally {
      setIsSaving(false);
      setIsPickerOpen(false);
      setFoodQuery('');
    }
  }

  async function handleUpdateItemGrams(itemId: string, grams: number) {
    const safeGrams = Number.isFinite(grams) ? Math.max(0, grams) : 0;
    setPlannedMeals((prev) =>
      prev.map((meal) => ({
        ...meal,
        planned_meal_items: meal.planned_meal_items.map((item) =>
          item.id === itemId ? { ...item, grams: safeGrams } : item
        ),
      }))
    );

    try {
      const { error: updateError } = await supabase
        .from('planned_meal_items')
        .update({ grams: safeGrams })
        .eq('id', itemId);

      if (updateError) throw updateError;
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to update planned item:', err);
      setError('Failed to update item quantity.');
      await loadWeekPlan();
    }
  }

  async function handleRemoveItem(itemId: string) {
    setIsSaving(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from('planned_meal_items')
        .delete()
        .eq('id', itemId);

      if (deleteError) throw deleteError;

      setPlannedMeals((prev) =>
        prev
          .map((meal) => ({
            ...meal,
            planned_meal_items: meal.planned_meal_items.filter((item) => item.id !== itemId),
          }))
          .filter((meal) => meal.planned_meal_items.length > 0 || meal.planned_date !== selectedDateStr)
      );
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to remove planned item:', err);
      setError('Failed to remove item.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClearSelectedDay() {
    setIsSaving(true);
    setError(null);
    try {
      const dayMeals = plannedMeals.filter((meal) => meal.planned_date === selectedDateStr);
      const ids = dayMeals.map((meal) => meal.id);
      if (ids.length === 0) return;

      const { error: deleteError } = await supabase
        .from('planned_meals')
        .delete()
        .in('id', ids);

      if (deleteError) throw deleteError;

      setPlannedMeals((prev) => prev.filter((meal) => meal.planned_date !== selectedDateStr));
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to clear planned day:', err);
      setError('Failed to clear this day.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyActualDay() {
    setIsCopyingActual(true);
    setError(null);
    try {
      const bounds = getLocalDayBounds(selectedDate);
      const { data, error: loadError } = await supabase
        .from('meals')
        .select(`
          *,
          meal_items (*, food:foods(*))
        `)
        .eq('user_id', user.id)
        .gte('created_at', bounds.start.toISOString())
        .lte('created_at', bounds.end.toISOString());

      if (loadError) throw loadError;

      const actualMeals = (data || []).map((meal) => mapMealRecord(meal as Record<string, unknown>));

      if (actualMeals.length === 0) {
        setError('No actual meals found for the selected day.');
        return;
      }

      await handleClearSelectedDay();

      const groupedMeals = actualMeals.reduce((acc, meal) => {
        const slot = getMealSlotForActualMeal(meal);
        if (!acc[slot]) acc[slot] = [];
        acc[slot].push(meal);
        return acc;
      }, {} as Record<PlannedMealSlot, Meal[]>);

      for (const slot of PLANNED_MEAL_SLOTS) {
        const mealsForSlot = groupedMeals[slot];
        if (!mealsForSlot || mealsForSlot.length === 0) continue;

        const sortedMeals = [...mealsForSlot].sort((a, b) => a.time.localeCompare(b.time));
        const firstMeal = sortedMeals[0];
        const mealPayload = buildPlannedMealInsertPayload(
          user.id,
          selectedDateStr,
          slot,
          firstMeal.name,
          firstMeal.time
        );

        const { data: createdMeal, error: mealError } = await supabase
          .from('planned_meals')
          .insert(mealPayload)
          .select(`
            *,
            planned_meal_items (*)
          `)
          .single();

        if (mealError) throw mealError;

        const mappedMeal = mapPlannedMealRecord(createdMeal as Record<string, unknown>);
        const newItems = [] as any[];

        for (const actualMeal of sortedMeals) {
          for (const item of actualMeal.items || []) {
            const food = item.foodId ? getFoodOrUnknown(foods, item.foodId) : null;
            const payload = buildPlannedMealItemInsertPayloadFromActualItem(
              mappedMeal.id,
              item as any,
              food ? (food as any) : null
            );

            const { data: createdItem, error: itemError } = await supabase
              .from('planned_meal_items')
              .insert(payload)
              .select()
              .single();

            if (itemError) throw itemError;

            newItems.push({
              id: String(createdItem.id),
              planned_meal_id: mappedMeal.id,
              food_id: payload.food_id,
              custom_name: payload.custom_name,
              grams: payload.grams,
              calories: payload.calories,
              protein: payload.protein,
              carbs: payload.carbs,
              fat: payload.fat,
              sugar: payload.sugar,
              saturated_fat: payload.saturated_fat,
              total_fiber: payload.total_fiber,
              soluble_fiber: payload.soluble_fiber,
              insoluble_fiber: payload.insoluble_fiber,
              gi: payload.gi,
              gl: payload.gl,
              is_vegetable: payload.is_vegetable,
              is_fruit: payload.is_fruit,
              is_plant_based: payload.is_plant_based,
              food_group: payload.food_group,
              created_at: createdItem.created_at ?? null,
              updated_at: createdItem.updated_at ?? null,
            });
          }
        }

        setPlannedMeals((prev) => [
          ...prev,
          {
            ...mappedMeal,
            planned_meal_items: newItems,
          },
        ]);
      }

      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to copy actual meals into plan:', err);
      setError('Failed to copy the selected day.');
    } finally {
      setIsCopyingActual(false);
      setIsSaving(false);
    }
  }

  const navigateDay = (offset: number) => {
    const next = addDays(selectedDate, offset);
    setDateAndWeek(next);
    setInternalView('day');
  };

  const navigateWeek = (offset: number) => {
    setWeekStart((current) => getMondayWeekStart(addDays(current, offset * 7)));
  };

  const dayTitle = `${format(selectedDate, 'EEEE')}, ${format(selectedDate, 'MMMM d')}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pb-24 space-y-6">
      <div className="bg-white border border-border shadow-sm rounded-[2rem] p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl bg-ink text-white flex items-center justify-center">
                <Calendar size={18} />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-ink">Plan</h1>
            </div>
            <p className="text-sm text-subtle">
              Day Plan for detailed editing. Week Plan for Monday-Sunday overview.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-2xl border border-border bg-gray-50 p-1">
              <button
                onClick={() => setInternalView('day')}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-bold transition-all',
                  internalView === 'day' ? 'bg-white text-ink shadow-sm' : 'text-subtle hover:text-ink'
                )}
              >
                Day
              </button>
              <button
                onClick={() => setInternalView('week')}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-bold transition-all',
                  internalView === 'week' ? 'bg-white text-ink shadow-sm' : 'text-subtle hover:text-ink'
                )}
              >
                Week
              </button>
            </div>

            {isSaving ? (
              <span className="flex items-center gap-2 text-sm text-accent font-semibold">
                <Loader2 size={14} className="animate-spin" />
                Saving
              </span>
            ) : lastSaved ? (
              <span className="flex items-center gap-2 text-sm text-accent/70 font-semibold">
                <CloudCheck size={14} />
                Saved {format(lastSaved, 'HH:mm')}
              </span>
            ) : (
              <span className="text-sm text-subtle">Ready</span>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {internalView === 'day' ? (
            <div className="flex items-center gap-2 bg-gray-50 rounded-2xl p-1 border border-border">
              <button
                onClick={() => navigateDay(-1)}
                className="p-2 rounded-xl hover:bg-white transition-all text-subtle hover:text-ink"
              >
                <ChevronLeft size={18} />
              </button>
              <input
                type="date"
                value={selectedDateStr}
                onChange={(e) => {
                  const next = new Date(`${e.target.value}T12:00:00`);
                  setDateAndWeek(next);
                }}
                className="bg-white border border-border rounded-xl px-3 py-2 text-sm font-semibold text-ink"
              />
              <button
                onClick={() => navigateDay(1)}
                className="p-2 rounded-xl hover:bg-white transition-all text-subtle hover:text-ink"
              >
                <ChevronRight size={18} />
              </button>
              <div className="hidden sm:block px-3 text-sm font-semibold text-subtle">{dayTitle}</div>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-gray-50 rounded-2xl p-1 border border-border">
              <button
                onClick={() => navigateWeek(-1)}
                className="p-2 rounded-xl hover:bg-white transition-all text-subtle hover:text-ink"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="px-4 py-2 text-sm font-semibold text-ink">{formatWeekRange(weekStart)}</div>
              <button
                onClick={() => navigateWeek(1)}
                className="p-2 rounded-xl hover:bg-white transition-all text-subtle hover:text-ink"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {internalView === 'day' && (
              <>
                <button
                  onClick={handleCopyActualDay}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-white text-sm font-bold text-ink hover:bg-gray-50 transition-all"
                >
                  <Copy size={14} />
                  Copy actual day
                </button>
                <button
                  onClick={handleClearSelectedDay}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-100 bg-red-50 text-sm font-bold text-red-700 hover:bg-red-100 transition-all"
                >
                  <Trash2 size={14} />
                  Clear day
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-accent" size={40} />
        </div>
      ) : internalView === 'day' ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_360px] gap-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLANNED_MEAL_SLOTS.map((slot) => {
                const meal = selectedDayMeals[slot];
                const items = meal?.planned_meal_items || [];
                const totals = calculatePlannedMealTotals(items);

                return (
                  <motion.section
                    key={slot}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-border shadow-sm rounded-[2rem] overflow-hidden"
                  >
                    <div className={cn('px-5 py-4 border-b flex items-center justify-between gap-3', slotAccent(slot))}>
                      <div>
                        <h2 className="font-black text-lg tracking-tight">{getPlannedMealSlotLabel(slot)}</h2>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
                          {items.length} item{items.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setPickerSlot(slot);
                          setIsPickerOpen(true);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/85 text-ink text-xs font-black uppercase tracking-widest hover:bg-white transition-all shadow-sm"
                      >
                        <Plus size={14} />
                        Add food
                      </button>
                    </div>

                    <div className="p-4 space-y-3">
                      {items.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-6 text-sm text-subtle text-center">
                          Add foods to build this meal.
                        </div>
                      ) : (
                        <AnimatePresence mode="popLayout">
                          {items.map((item) => {
                            const food = item.food_id ? getFoodOrUnknown(foods, item.food_id) : null;
                            const displayName = toMealItemDisplayName(item as Record<string, any>, food);
                            const isVeg = item.is_vegetable === true || (food ? isConservativeVegetable(food) : false);
                            return (
                              <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                className="rounded-2xl border border-border bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="font-bold text-ink truncate">{displayName}</h3>
                                      {isVeg && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                                          <Leaf size={11} />
                                          Veg
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-subtle">
                                      {formatNutritionCell({
                                        value: item.grams,
                                        reliable: true,
                                      }, 0)}
                                      g planned
                                    </p>
                                  </div>

                                  <button
                                    onClick={() => handleRemoveItem(item.id)}
                                    className="p-2 rounded-xl text-subtle hover:text-red-600 hover:bg-red-50 transition-all"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>

                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-bold">
                                  <MetricChip label="Calories" value={formatNutritionCell({ value: item.calories ?? 0, reliable: item.calories != null })} suffix="kcal" />
                                  <MetricChip label="Protein" value={formatNutritionCell({ value: item.protein ?? 0, reliable: item.protein != null })} suffix="g" />
                                  <MetricChip label="Carbs" value={formatNutritionCell({ value: item.carbs ?? 0, reliable: item.carbs != null })} suffix="g" />
                                  <MetricChip label="Fat" value={formatNutritionCell({ value: item.fat ?? 0, reliable: item.fat != null })} suffix="g" />
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                                  <MetricPill label="Sugar" value={formatNutritionCell({ value: item.sugar ?? 0, reliable: item.sugar != null })} />
                                  <MetricPill label="Sat fat" value={formatNutritionCell({ value: item.saturated_fat ?? 0, reliable: item.saturated_fat != null })} />
                                  <MetricPill label="Fiber" value={formatNutritionCell({ value: item.total_fiber ?? 0, reliable: item.total_fiber != null })} />
                                  <MetricPill label="GL" value={item.gl == null ? '—' : Math.round(item.gl).toString()} />
                                </div>

                                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="relative flex-1 sm:max-w-[140px]">
                                    <input
                                      type="number"
                                      min={0}
                                      value={item.grams}
                                      onChange={(e) =>
                                        setPlannedMeals((prev) =>
                                          prev.map((mealEntry) => ({
                                            ...mealEntry,
                                            planned_meal_items: mealEntry.planned_meal_items.map((mealItem) =>
                                              mealItem.id === item.id
                                                ? { ...mealItem, grams: Number(e.target.value) || 0 }
                                                : mealItem
                                            ),
                                          }))
                                        )
                                      }
                                      onBlur={(e) => void handleUpdateItemGrams(item.id, Number(e.target.value) || 0)}
                                      className="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm font-bold text-ink focus:ring-2 focus:ring-accent/30"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-subtle">
                                      g
                                    </span>
                                  </div>
                                  <div className="text-[11px] font-semibold uppercase tracking-widest text-subtle">
                                    {item.is_vegetable === true ? 'Vegetable' : item.is_fruit === true ? 'Fruit' : item.is_plant_based === true ? 'Plant-based' : 'Planned'}
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      )}

                      <div className="rounded-2xl bg-gray-50 border border-border px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-subtle">Slot subtotal</span>
                          <span className="text-sm font-black text-ink">
                            {formatNutritionCell(totals.calories)} kcal
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold">
                          <MetricChip label="Protein" value={formatNutritionCell(totals.protein)} suffix="g" />
                          <MetricChip label="Carbs" value={formatNutritionCell(totals.carbs)} suffix="g" />
                          <MetricChip label="Fat" value={formatNutritionCell(totals.fat)} suffix="g" />
                          <MetricChip label="Fiber" value={formatNutritionCell(totals.total_fiber)} suffix="g" />
                        </div>
                      </div>
                    </div>
                  </motion.section>
                );
              })}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="bg-white border border-border shadow-sm rounded-[2rem] p-5 sticky top-4">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-accent" />
                <h3 className="font-black text-ink">Daily summary</h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SummaryTile label="Calories" value={formatNutritionCell(selectedDayTotals.calories)} suffix="kcal" />
                <SummaryTile label="Protein" value={formatNutritionCell(selectedDayTotals.protein)} suffix="g" />
                <SummaryTile label="Carbs" value={formatNutritionCell(selectedDayTotals.carbs)} suffix="g" />
                <SummaryTile label="Fat" value={formatNutritionCell(selectedDayTotals.fat)} suffix="g" />
                <SummaryTile label="Sugar" value={formatNutritionCell(selectedDayTotals.sugar)} suffix="g" />
                <SummaryTile label="Sat fat" value={formatNutritionCell(selectedDayTotals.saturated_fat)} suffix="g" />
                <SummaryTile label="Total fiber" value={formatNutritionCell(selectedDayTotals.total_fiber)} suffix="g" />
                <SummaryTile label="Soluble fiber" value={formatNutritionCell(selectedDayTotals.soluble_fiber)} suffix="g" />
                <SummaryTile label="Insoluble fiber" value={formatNutritionCell(selectedDayTotals.insoluble_fiber)} suffix="g" />
                <SummaryTile label="GL" value={selectedDayTotals.gl.reliable ? Math.round(selectedDayTotals.gl.value).toString() : '—'} suffix="" />
                <SummaryTile label="Vegetables" value={formatNutritionCell(selectedDayTotals.vegetables_grams)} suffix="g" />
                <SummaryTile label="Fruit" value={formatNutritionCell(selectedDayTotals.fruit_grams)} suffix="g" />
                <SummaryTile label="Plant-based" value={formatNutritionCell(selectedDayTotals.plant_based_grams)} suffix="g" />
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
            {weekDaySummaries.map((day) => (
              <motion.button
                key={day.dateStr}
                layout
                onClick={() => {
                  setDateAndWeek(day.date);
                  setInternalView('day');
                }}
                className="text-left bg-white border border-border shadow-sm rounded-[1.75rem] p-4 hover:border-accent/30 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">
                      {format(day.date, 'EEE')}
                    </div>
                    <div className="mt-1 font-black text-ink">{format(day.date, 'd')}</div>
                  </div>
                  <div className="text-[11px] font-black uppercase tracking-widest text-accent">
                    {day.plannedCount} meal{day.plannedCount === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-[11px] font-bold">
                  <CardLine label="Calories" value={formatNutritionCell(day.totals.calories)} suffix="kcal" />
                  <CardLine label="Protein" value={formatNutritionCell(day.totals.protein)} suffix="g" />
                  <CardLine label="Total fiber" value={formatNutritionCell(day.totals.total_fiber)} suffix="g" />
                  <CardLine label="Soluble fiber" value={formatNutritionCell(day.totals.soluble_fiber)} suffix="g" />
                  <CardLine label="Insoluble fiber" value={formatNutritionCell(day.totals.insoluble_fiber)} suffix="g" />
                  <CardLine label="Vegetables" value={formatNutritionCell(day.totals.vegetables_grams)} suffix="g" />
                  <CardLine label="Fruit" value={formatNutritionCell(day.totals.fruit_grams)} suffix="g" />
                  <CardLine label="Plant-based" value={formatNutritionCell(day.totals.plant_based_grams)} suffix="g" />
                </div>
              </motion.button>
            ))}
          </div>

          <div className="bg-white border border-border shadow-sm rounded-[2rem] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-accent" />
              <h3 className="font-black text-ink">Week summary</h3>
              <span className="text-xs font-semibold text-subtle">Daily averages</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              <SummaryTile label="Avg calories/day" value={formatNutritionCell(weekSummary.calories)} suffix="kcal" />
              <SummaryTile label="Avg protein/day" value={formatNutritionCell(weekSummary.protein)} suffix="g" />
              <SummaryTile label="Avg total fiber/day" value={formatNutritionCell(weekSummary.total_fiber)} suffix="g" />
              <SummaryTile label="Avg soluble/day" value={formatNutritionCell(weekSummary.soluble_fiber)} suffix="g" />
              <SummaryTile label="Avg insoluble/day" value={formatNutritionCell(weekSummary.insoluble_fiber)} suffix="g" />
              <SummaryTile label="Avg vegetables/day" value={formatNutritionCell(weekSummary.vegetables_grams)} suffix="g" />
              <SummaryTile label="Avg fruit/day" value={formatNutritionCell(weekSummary.fruit_grams)} suffix="g" />
              <SummaryTile label="Avg plant-based/day" value={formatNutritionCell(weekSummary.plant_based_grams)} suffix="g" />
            </div>

            <div className="mt-4 text-sm font-semibold text-subtle">
              Planned days: {weekDaySummaries.filter((day) => day.plannedCount > 0).length} / 7
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {isPickerOpen && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/60 backdrop-blur-md"
              onClick={() => {
                setIsPickerOpen(false);
                setFoodQuery('');
              }}
            />

            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              className="relative w-full sm:max-w-2xl max-h-[88vh] overflow-hidden bg-white sm:rounded-[2rem] rounded-t-[2rem] shadow-2xl border border-border"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h3 className="font-black text-xl text-ink">Add food</h3>
                  <p className="text-sm text-subtle">{getPlannedMealSlotLabel(pickerSlot)} for {dayLabel}</p>
                </div>
                <button
                  onClick={() => {
                    setIsPickerOpen(false);
                    setFoodQuery('');
                  }}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors text-subtle"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle" size={18} />
                  <input
                    type="text"
                    value={foodQuery}
                    onChange={(e) => setFoodQuery(e.target.value)}
                    placeholder="Search existing foods..."
                    className="w-full rounded-2xl border border-border bg-gray-50 pl-11 pr-4 py-3 text-sm font-medium text-ink focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {PLANNED_MEAL_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      onClick={() => setPickerSlot(slot)}
                      className={cn(
                        'px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-widest transition-all',
                        pickerSlot === slot
                          ? 'bg-ink text-white border-ink'
                          : 'bg-white text-subtle border-border hover:text-ink'
                      )}
                    >
                      {getPlannedMealSlotShortLabel(slot)}
                    </button>
                  ))}
                </div>

                <div className="max-h-[52vh] overflow-y-auto space-y-2 pr-1">
                  {filteredFoods.map((food) => {
                    const isVeg = isConservativeVegetable(food);
                    return (
                      <button
                        key={food.id}
                        onClick={() => void handleAddFood(pickerSlot, food)}
                        className="w-full text-left rounded-2xl border border-border bg-white p-4 hover:border-accent/30 hover:bg-gray-50 transition-all flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-ink truncate">{food.name_hu}</span>
                            {isVeg && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                                <Leaf size={11} />
                                Veg
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-subtle">
                            <span>{Math.round(food.calories || 0)} kcal / 100g</span>
                            <span>{Math.round(food.protein || 0)}P</span>
                            <span>{Math.round(food.carbs || 0)}C</span>
                            <span>{Math.round(food.fat || 0)}F</span>
                            <span>Fiber {Math.round(food.total_fiber || 0)}g</span>
                          </div>
                        </div>
                        <div className="text-accent font-black text-xs uppercase tracking-widest pt-1">Add</div>
                      </button>
                    );
                  })}

                  {filteredFoods.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border bg-gray-50 p-6 text-center text-sm text-subtle">
                      No matching foods found.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MetricChip({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-border px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-subtle">{label}</div>
      <div className="mt-1 text-sm font-black text-ink">
        {value}
        {suffix ? <span className="text-[10px] ml-1 text-subtle font-bold">{suffix}</span> : null}
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-bold text-subtle">
      <span className="uppercase tracking-widest text-[9px]">{label}</span>
      <span className="text-ink">{value}</span>
    </span>
  );
}

function SummaryTile({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-gray-50 px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-subtle">{label}</div>
      <div className="mt-1 text-lg font-black text-ink">
        {value}
        {suffix ? <span className="ml-1 text-xs font-bold text-subtle">{suffix}</span> : null}
      </div>
    </div>
  );
}

function CardLine({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-xl border border-border bg-gray-50 px-3 py-2 flex items-center justify-between gap-3">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-subtle">{label}</span>
      <span className="text-sm font-black text-ink">
        {value}
        {suffix ? <span className="ml-1 text-[10px] font-bold text-subtle">{suffix}</span> : null}
      </span>
    </div>
  );
}

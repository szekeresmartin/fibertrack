/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Clock,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Edit2,
  Search,
  X,
  Save,
  ArrowLeft,
  LogOut,
  Mail,
  Loader2,
  Lock,
  Download,
  Calendar,
  Copy,
  BarChart2,
  Scale,
  MoreHorizontal,
  SlidersHorizontal,
  UtensilsCrossed,
} from 'lucide-react';
import { Food, Meal, DailyTotals } from './types';
import { fetchFoodsFromSheets } from './lib/googleSheets';
import { cn, calculateMealTotals, getFriendlyErrorMessage, getGlycemicLoadLabel, getFoodOrUnknown } from './lib/utils';
import { generateRangeSummaryText } from './lib/exportUtils';
import StatisticsView from './components/StatisticsView';
import WeightView from './components/WeightView';
import { buildMealItemWritePayloads, buildMealWritePayload, mapMealRecord } from './lib/mealItemUtils';
import { format, addDays, isSameDay, isToday, subDays } from 'date-fns';
import { computeStats, ProcessedStats } from './lib/statsUtils';
import UnifiedExportModal from './components/UnifiedExportModal';
import DatePickerModal from './components/DatePickerModal';
import { supabase } from './lib/supabase';
import { User } from '@supabase/supabase-js';
import { getLocalDayBounds } from './lib/dateUtils';
import { buildExportRange, type ExportRangePreset } from './lib/exportRange';

// No mock authentication, fully relying on Supabase state.

// ─── DayStrip Component ───────────────────────────────────────────────────────
interface DayStripProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  onOpenPicker: () => void;
}

function DayStrip({ selectedDate, onSelect, onOpenPicker }: DayStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Generate 7 days centered on selectedDate
  const days = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(selectedDate, i - 3));
  }, [selectedDate]);

  useEffect(() => {
    // Auto-scroll to selected day on change
    const activeBtn = containerRef.current?.querySelector('[data-active="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selectedDate]);

  return (
    <div 
      ref={containerRef}
      className="flex gap-1.5 overflow-x-auto pb-2 pt-1 no-scrollbar scroll-smooth px-3 sm:px-0 lg:gap-2 lg:pb-4 lg:pt-2"
      style={{ scrollSnapType: 'x proximity' }}
    >
      {days.map((day) => {
        const active = isSameDay(day, selectedDate);
        const today = isToday(day);
        
        return (
          <button
            key={day.toISOString()}
            data-active={active}
            onClick={() => onSelect(day)}
            className={cn(
              "flex flex-col items-center min-w-[50px] py-2 rounded-2xl transition-all active:scale-95 lg:min-w-[56px] lg:py-3",
              active 
                ? "bg-ink text-white shadow-lg scale-105" 
                : "bg-white border border-border text-subtle hover:border-accent/40"
            )}
            style={{ scrollSnapAlign: 'center' }}
          >
            <span className={cn(
              "text-[9px] font-bold uppercase tracking-widest mb-0.5 lg:text-[10px] lg:mb-1",
              today && !active && "text-accent"
            )}>
              {format(day, 'EEE')}
            </span>
            <span className="text-[16px] font-extrabold leading-none lg:text-[18px]">
              {format(day, 'd')}
            </span>
            {today && !active && (
              <div className="w-1 h-1 bg-accent rounded-full mt-1" />
            )}
          </button>
        );
      })}
    </div>
  );
}
// --------------------------------------

function isStaleSupabaseSessionError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');

  const normalized = message.toLowerCase();
  return normalized.includes('invalid refresh token') && normalized.includes('refresh token not found');
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [foods, setFoods] = useState<Food[]>([]);
  const [sheetUrl, setSheetUrl] = useState<string>(() => {
    return localStorage.getItem('fiber_track_sheet_url') || '';
  });
  const [view, setView] = useState<'timeline' | 'database' | 'statistics' | 'weight'>('timeline');
  const [statsMeals, setStatsMeals] = useState<Meal[]>([]);
  const [statsDays, setStatsDays] = useState<7 | 30 | 90 | 3650>(7);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [isMealModalOpen, setIsMealModalOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mealToDuplicate, setMealToDuplicate] = useState<Meal | null>(null);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isDuplicateDayModalOpen, setIsDuplicateDayModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportModalRange, setExportModalRange] = useState(() => buildExportRange('today'));
  const [exportModalDataType, setExportModalDataType] = useState<'nutrition' | 'weight' | 'bowel_movements'>('nutrition');
  const [exportModalFormat, setExportModalFormat] = useState<'csv' | 'text' | 'pdf'>('text');
  const [mobileActionMenu, setMobileActionMenu] = useState<'more' | null>(null);
  const [statsCache, setStatsCache] = useState<Record<string, ProcessedStats>>({});
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [selectedMealId, setSelectedMealId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [toastMessage, setToastMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [quickAddInput, setQuickAddInput] = useState('');
  const nowIndicatorRef = useRef<HTMLDivElement>(null);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    if (type === 'success') {
      setTimeout(() => setToastMessage(null), 3000);
    } else {
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const openExportModal = (
    preset: ExportRangePreset = 'today',
    options: {
      dataType?: 'nutrition' | 'weight' | 'bowel_movements';
      formatType?: 'csv' | 'text' | 'pdf';
    } = {}
  ) => {
    const nextRange = buildExportRange(preset);
    setExportModalRange(nextRange);
    setExportModalDataType(options.dataType ?? 'nutrition');
    setExportModalFormat(options.formatType ?? (options.dataType === 'weight' || options.dataType === 'bowel_movements' ? 'csv' : 'text'));
    setIsExportModalOpen(true);
    setMobileActionMenu(null);
  };

  useEffect(() => {
    if ((view as string) === 'plan') {
      setView('timeline');
    }
  }, [view]);

  const logDuplicateMealError = (operation: string, sourceMeal: Meal, targetDate: string, targetTime: string, error: unknown) => {
    const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
    if (!isDev) return;

    const supabaseError = error && typeof error === 'object'
      ? {
          code: 'code' in error ? String((error as Record<string, unknown>).code ?? '') : undefined,
          message: 'message' in error ? String((error as Record<string, unknown>).message ?? '') : undefined,
          details: 'details' in error ? String((error as Record<string, unknown>).details ?? '') : undefined,
          hint: 'hint' in error ? String((error as Record<string, unknown>).hint ?? '') : undefined,
        }
      : { message: String(error ?? '') };

    console.error('[Meal duplicate] Supabase error', {
      operation,
      sourceMealId: sourceMeal.id,
      targetDate,
      targetTime,
      supabaseError,
    });
  };

  type DuplicateDayFailurePhase = 'source read phase' | 'meal insert phase' | 'meal_items insert phase' | 'rollback phase';

  type DuplicateDayFailureLog = {
    operationStep: string;
    failingTable: string;
    payload: unknown;
    returnedData: unknown;
    insertedMealIds: string[];
    sourceMealIds: string[];
    sourceDate: string;
    targetDate: string;
    keepOriginalMealTimes: boolean;
    sourceMealCount: number;
    sourceItemCount: number;
    supabaseError: {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
      rawMessage?: string;
    };
  };

  const isDevMode = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

  const serializeDuplicateDayLog = (log: DuplicateDayFailureLog) => {
    try {
      return JSON.stringify(log);
    } catch (serializationError) {
      return JSON.stringify({
        operationStep: log.operationStep,
        failingTable: log.failingTable,
        serializationError: serializationError instanceof Error ? serializationError.message : String(serializationError),
      });
    }
  };

  const buildDuplicateDayErrorDetails = (error: unknown) => {
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      return {
        code: 'code' in record ? String(record.code ?? '') : undefined,
        message: 'message' in record ? String(record.message ?? '') : undefined,
        details: 'details' in record ? String(record.details ?? '') : undefined,
        hint: 'hint' in record ? String(record.hint ?? '') : undefined,
        rawMessage: String(record.message ?? record.details ?? record.hint ?? error ?? ''),
      };
    }

    return {
      rawMessage: String(error ?? ''),
    };
  };

  const logDuplicateDayFailure = (
    operationStep: DuplicateDayFailurePhase,
    failingTable: string,
    payload: unknown,
    returnedData: unknown,
    sourceDate: string,
    targetDate: string,
    keepOriginalMealTimes: boolean,
    sourceMealCount: number,
    sourceItemCount: number,
    sourceMealIds: string[],
    insertedMealIds: string[],
    error: unknown
  ) => {
    if (!isDevMode) return;

    const logObject: DuplicateDayFailureLog = {
      operationStep,
      failingTable,
      payload,
      returnedData,
      insertedMealIds,
      sourceMealIds,
      sourceDate,
      targetDate,
      keepOriginalMealTimes,
      sourceMealCount,
      sourceItemCount,
      supabaseError: buildDuplicateDayErrorDetails(error),
    };

    console.error('[Duplicate Day] Failure', logObject, serializeDuplicateDayLog(logObject));
  };

  const rollbackDuplicateDayInsertions = async (
    insertedMealIds: string[],
    sourceDate: string,
    targetDate: string,
    keepOriginalMealTimes: boolean,
    sourceMealCount: number,
    sourceItemCount: number,
    sourceMealIds: string[]
  ) => {
    if (insertedMealIds.length === 0) return;

    const { error: mealItemsRollbackError } = await supabase
      .from('meal_items')
      .delete()
      .in('meal_id', insertedMealIds)
      .select('id');

    if (mealItemsRollbackError) {
      logDuplicateDayFailure(
        'rollback phase',
        'meal_items',
        { mealIds: insertedMealIds },
        null,
        sourceDate,
        targetDate,
        keepOriginalMealTimes,
        sourceMealCount,
        sourceItemCount,
        sourceMealIds,
        insertedMealIds,
        mealItemsRollbackError
      );
    }

    const { error: mealsRollbackError } = await supabase
      .from('meals')
      .delete()
      .in('id', insertedMealIds)
      .select('id');

    if (mealsRollbackError) {
      logDuplicateDayFailure(
        'rollback phase',
        'meals',
        { ids: insertedMealIds },
        null,
        sourceDate,
        targetDate,
        keepOriginalMealTimes,
        sourceMealCount,
        sourceItemCount,
        sourceMealIds,
        insertedMealIds,
        mealsRollbackError
      );
    }
  };

  const fetchMealsForRange = async (startDate: string, endDate: string): Promise<Meal[]> => {
    if (!user) return [];

    const startBounds = getLocalDayBounds(startDate);
    const endBounds = getLocalDayBounds(endDate);

    const { data, error } = await supabase
      .from('meals')
      .select(`
        *,
        meal_items (*, food:foods(*))
      `)
      .eq('user_id', user.id)
      .gte('created_at', startBounds.start.toISOString())
      .lte('created_at', endBounds.end.toISOString());

    if (error) {
      throw error;
    }

    return (data || []).map((meal: any) => mapMealRecord(meal));
  };

  const copySummaryForRange = async (range: { start: string; end: string }, successMessage: string) => {
    if (!user) return;

    try {
      const mealsForRange = await fetchMealsForRange(range.start, range.end);
      if (mealsForRange.length === 0) {
        showToast('No data found for this range', 'error');
        return;
      }

      const summary = generateRangeSummaryText(mealsForRange, foods, range);
      await navigator.clipboard.writeText(summary);
      showToast(successMessage, 'success');
    } catch (err) {
      console.error('Failed to copy range summary:', err);
      showToast('Failed to copy summary', 'error');
    }
  };

  // --------------------------------------
  // Root-level Auth Handler
  // --------------------------------------
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (cancelled) return;

        if (error) {
          if (isStaleSupabaseSessionError(error)) {
            void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
            if (!cancelled) {
              setUser(null);
            }
          } else {
            console.error('Error restoring Supabase session:', error);
          }
        } else {
          setUser(session?.user ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Unexpected Supabase session error:', error);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }
      setUser(session?.user ?? null);
      setSessionLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch Meals from Supabase
  useEffect(() => {
    if (!user) return;

    const fetchMeals = async () => {
      const { start: startOfDay, end: endOfDay } = getLocalDayBounds(selectedDate);

      const { data, error } = await supabase
        .from('meals')
        .select(`
          *,
          meal_items (*, food:foods(*))
        `)
        .eq('user_id', user.id)
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString());

      if (error) {
        console.error('Error fetching meals:', error);
      } else if (data) {
        setMeals(data.map((meal: any) => mapMealRecord(meal)));
      } else {
        setMeals([]);
      }
    };

    fetchMeals();
  }, [user, selectedDate]);

  // Fetch Stats data (7 or 30 days)
  useEffect(() => {
    if (!user || (view !== 'statistics' && view !== 'weight')) return;

    const fetchStatsData = async () => {
      setIsStatsLoading(true);
      const endDate = new Date();
      const fetchDays = view === 'weight' ? 180 : (statsDays === 3650 ? 3650 : statsDays * 2);
      const startDate = subDays(endDate, fetchDays - 1);
      const { end: endBoundary } = getLocalDayBounds(endDate);
      const { start: startOfRange } = getLocalDayBounds(startDate);

      const { data, error } = await supabase
        .from('meals')
        .select(`
          *,
          meal_items (*, food:foods(*))
        `)
        .eq('user_id', user.id)
        .gte('created_at', startOfRange.toISOString())
        .lte('created_at', endBoundary.toISOString());

      if (error) {
        console.error('Error fetching stats meals:', error);
        showToast('Failed to load statistics', 'error');
      } else if (data) {
        setStatsMeals(data.map((meal: any) => mapMealRecord(meal)));
      }
      setIsStatsLoading(false);
    };

    fetchStatsData();
  }, [user, view, statsDays]);

  // Load foods
  useEffect(() => {
    const loadFoods = async () => {
      setIsLoading(true);

      const savedLocalFoods = localStorage.getItem('fiber_track_local_foods');
      const localFoods: Food[] = savedLocalFoods ? JSON.parse(savedLocalFoods) : [];

      // 1-3. Fetch from Supabase without filters
      const { data: supabaseFoods, error: supabaseError } = await supabase
        .from('foods')
        .select('*');

      // 4. Log the result to console
      console.log('Supabase foods fetch result:', { data: supabaseFoods, error: supabaseError });

      let combinedFoods = supabaseFoods ? [...supabaseFoods] : [];

      // Also try fetching sheet foods if configured
      if (sheetUrl) {
        try {
          const sheetFoods = await fetchFoodsFromSheets(sheetUrl);
          combinedFoods = [...combinedFoods, ...sheetFoods];
        } catch (err) {
          console.error('Sheet fetch failed:', err);
        }
      }

      // Combine with local foods
      localFoods.forEach(local => {
        if (local.source === 'local') {
          if (!combinedFoods.find(f => f.name_hu === local.name_hu)) {
            combinedFoods.push(local);
          }
        }
      });

      // 5. Verify the state update: update foods state
      setFoods(combinedFoods);
      setIsLoading(false);
    };

    loadFoods();
  }, [sheetUrl]);

  useEffect(() => {
    console.log('FINAL foods state:', foods);
  }, [foods]);

  useEffect(() => {
    localStorage.setItem('fiber_track_sheet_url', sheetUrl);
  }, [sheetUrl]);

  // Auto-scroll to "Now" indicator on today's view
  useEffect(() => {
    if (view === 'timeline' && isToday(selectedDate) && nowIndicatorRef.current) {
      const timer = setTimeout(() => {
        nowIndicatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [selectedDate, meals.length, view]);

  useEffect(() => {
    setMobileActionMenu(null);
  }, [view]);

  const dailyTotals = useMemo(() => {
    return meals.reduce((acc, meal) => {
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId || ''),
        quantity: item.quantityGrams,
        customMacros: item
      }));

      const totals = calculateMealTotals(mealItems);
      return {
        calories: acc.calories + totals.calories,
        carbs: acc.carbs + totals.carbs,
        protein: acc.protein + totals.protein,
        fat: acc.fat + totals.fat,
        soluble_fiber: acc.soluble_fiber + totals.soluble_fiber,
        insoluble_fiber: acc.insoluble_fiber + totals.insoluble_fiber,
        total_fiber: acc.total_fiber + totals.total_fiber,
        gl: acc.gl + totals.gl,
      };
    }, {
      calories: 0, carbs: 0, protein: 0, fat: 0,
      soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0, gl: 0
    });
  }, [meals, foods]);
  const mobileFiberGoal = 35;
  const mobileFiberProgress = Math.max(0, Math.min(100, (dailyTotals.total_fiber / mobileFiberGoal) * 100));

  const sortedMeals = useMemo(() => {
    return [...meals].sort((a, b) => a.time.localeCompare(b.time));
  }, [meals]);

  useEffect(() => {
    if (selectedMealId && !sortedMeals.some(m => String(m.id) === selectedMealId)) {
      setSelectedMealId(null);
    }
  }, [sortedMeals, selectedMealId]);

  const selectedMeal = useMemo(() => sortedMeals.find(m => String(m.id) === selectedMealId) || null, [sortedMeals, selectedMealId]);

  const handleSaveMeal = async (meal: Partial<Meal>) => {
    if (!user) throw new Error("User not authenticated.");

    let mealPayload = buildMealWritePayload(meal, user.id);

    if (!meal.id) {
      const mealDate = new Date(selectedDate);
      const [hours, minutes] = meal.time.split(':');
      mealDate.setHours(Number(hours), Number(minutes), 0, 0);
      mealPayload = buildMealWritePayload(meal, user.id, mealDate.toISOString());
    }

    const { data: insertedMeal, error } = await supabase
      .from('meals')
      .upsert(mealPayload)
      .select()
      .single();

    if (error) {
      console.error('Error saving meal:', error);
      showToast(getFriendlyErrorMessage(error), 'error');
      throw new Error(getFriendlyErrorMessage(error));
    }

    if (meal.items && meal.items.length > 0) {
      if (meal.id) {
        await supabase.from('meal_items').delete().eq('meal_id', meal.id);
      }
      
      const itemsToInsert = buildMealItemWritePayloads(insertedMeal.id, meal.items, foods);

      const { error: itemsError } = await supabase.from('meal_items').insert(itemsToInsert);
      if (itemsError) {
        console.error('Error saving meal items:', itemsError);
        // Transaction safety: rollback the freshly inserted meal to prevent partial UI/DB state
        if (!meal.id) {
          await supabase.from('meals').delete().eq('id', insertedMeal.id);
        }
        showToast(getFriendlyErrorMessage(itemsError), 'error');
        throw new Error(getFriendlyErrorMessage(itemsError));
      }
    }

    const completeMeal = { ...insertedMeal, items: meal.items || [] };

    if (editingMeal) {
      setMeals(meals.map(m => m.id === completeMeal.id ? completeMeal : m));
    } else {
      setMeals([...meals, completeMeal]);
    }
    
    setIsMealModalOpen(false);
    setEditingMeal(null);
    showToast('Meal saved successfully!', 'success');
  };
  
  const handleDuplicateMeal = async (meal: Meal, targetDateStr: string, targetTime: string) => {
    if (!user) return;
    
    // Combine date and time in ISO format to avoid timezone issues
    const targetDate = new Date(`${targetDateStr}T${targetTime}`);
    const { id: _sourceMealId, ...mealWithoutId } = meal as Meal & { id?: string };

    const mealPayload = buildMealWritePayload(
      { ...mealWithoutId, time: targetTime },
      user.id,
      targetDate.toISOString()
    );

    const { data: insertedMeal, error: mealError } = await supabase
      .from('meals')
      .insert(mealPayload)
      .select()
      .single();

    if (mealError) {
      logDuplicateMealError('insert meal', meal, targetDateStr, targetTime, mealError);
      showToast(getFriendlyErrorMessage(mealError), 'error');
      return;
    }

    if (meal.items && meal.items.length > 0) {
      const itemsToInsert = buildMealItemWritePayloads(insertedMeal.id, meal.items, foods);

      const { error: itemsError } = await supabase.from('meal_items').insert(itemsToInsert);
      
      if (itemsError) {
        logDuplicateMealError('insert meal_items', meal, targetDateStr, targetTime, itemsError);
        // Rollback meal if items fail
        await supabase.from('meals').delete().eq('id', insertedMeal.id);
        showToast(getFriendlyErrorMessage(itemsError), 'error');
        return;
      }
    }

    // Navigation and feedback
    setSelectedDate(targetDate);
    setIsDuplicateModalOpen(false);
    setMealToDuplicate(null);
    showToast('Meal duplicated!', 'success');
  };

  const handleDuplicateDay = async (targetDateStr: string, keepOriginalTimes: boolean) => {
    if (!user) return;

    const sourceDateStr = format(selectedDate, 'yyyy-MM-dd');
    const { start: sourceDayStart, end: sourceDayEnd } = getLocalDayBounds(sourceDateStr);
    const duplicateDayErrorMessage = 'Could not duplicate this day. Please try again.';
    const { data: sourceMealsRaw, error: sourceReadError } = await supabase
      .from('meals')
      .select(`
        *,
        meal_items (*, food:foods(*))
      `)
      .eq('user_id', user.id)
      .gte('created_at', sourceDayStart.toISOString())
      .lte('created_at', sourceDayEnd.toISOString());

    if (sourceReadError) {
      logDuplicateDayFailure(
        'source read phase',
        'meals',
        {
          user_id: user.id,
          sourceDate: sourceDateStr,
        },
        sourceMealsRaw,
        sourceDateStr,
        targetDateStr,
        keepOriginalTimes,
        0,
        0,
        [],
        [],
        sourceReadError
      );
      showToast(duplicateDayErrorMessage, 'error');
      return;
    }

    const sourceMeals = (sourceMealsRaw || []).map((meal: any) => mapMealRecord(meal));
    if (sourceMeals.length === 0) {
      showToast('No meals to duplicate today', 'error');
      return;
    }

    const sourceMealCount = sourceMeals.length;
    const sourceItemCount = sourceMeals.reduce((count, meal) => count + (meal.items?.length || 0), 0);
    const sourceMealIds = sourceMeals.map((meal) => String(meal.id));

    const mealsToInsert = sourceMeals.map((meal) => {
      const mealTime = keepOriginalTimes ? meal.time : '12:00';
      const { id: _sourceMealId, ...mealWithoutId } = meal as Meal & { id?: string };
      const newMealId = crypto.randomUUID();
      return buildMealWritePayload(
        { ...mealWithoutId, id: newMealId, time: mealTime },
        user.id,
        `${targetDateStr}T${mealTime}`
      );
    });

    const insertedMealIds = mealsToInsert.map((meal) => String(meal.id ?? ''));
    const { data: insertedMeals, error: mealError } = await supabase.from('meals').insert(mealsToInsert).select();
    if (mealError) {
      logDuplicateDayFailure(
        'meal insert phase',
        'meals',
        mealsToInsert,
        insertedMeals,
        sourceDateStr,
        targetDateStr,
        keepOriginalTimes,
        sourceMealCount,
        sourceItemCount,
        sourceMealIds,
        insertedMealIds,
        mealError
      );
      await rollbackDuplicateDayInsertions(
        insertedMealIds,
        sourceDateStr,
        targetDateStr,
        keepOriginalTimes,
        sourceMealCount,
        sourceItemCount,
        sourceMealIds
      );
      showToast(duplicateDayErrorMessage, 'error');
      return;
    }

    const insertedMealRows = insertedMeals || [];

    if (insertedMealRows.length !== mealsToInsert.length) {
      const mismatchError = new Error(`Inserted meal count mismatch: expected ${mealsToInsert.length}, received ${insertedMealRows.length}`);
      logDuplicateDayFailure(
        'meal insert phase',
        'meals',
        mealsToInsert,
        insertedMealRows,
        sourceDateStr,
        targetDateStr,
        keepOriginalTimes,
        sourceMealCount,
        sourceItemCount,
        sourceMealIds,
        insertedMealIds,
        mismatchError
      );
      await rollbackDuplicateDayInsertions(
        insertedMealIds,
        sourceDateStr,
        targetDateStr,
        keepOriginalTimes,
        sourceMealCount,
        sourceItemCount,
        sourceMealIds
      );
      showToast(duplicateDayErrorMessage, 'error');
      return;
    }

    const itemsToInsert: any[] = sourceMeals.flatMap((originalMeal, index) => {
      const newMealId = insertedMealIds[index];
      return buildMealItemWritePayloads(newMealId, originalMeal.items || [], foods);
    });

    if (itemsToInsert.length > 0) {
      const { data: insertedMealItems, error: itemsError } = await supabase.from('meal_items').insert(itemsToInsert).select();
      if (itemsError) {
        logDuplicateDayFailure(
          'meal_items insert phase',
          'meal_items',
          itemsToInsert,
          insertedMealItems,
          sourceDateStr,
          targetDateStr,
          keepOriginalTimes,
          sourceMealCount,
          sourceItemCount,
          sourceMealIds,
          insertedMealIds,
          itemsError
        );
        await rollbackDuplicateDayInsertions(
          insertedMealIds,
          sourceDateStr,
          targetDateStr,
          keepOriginalTimes,
          sourceMealCount,
          sourceItemCount,
          sourceMealIds
        );
        showToast(duplicateDayErrorMessage, 'error');
        return;
      }
    }

    setSelectedDate(new Date(`${targetDateStr}T12:00:00`));
    setIsDuplicateDayModalOpen(false);
    showToast(`Duplicated ${meals.length} meals!`, 'success');
  };
  const handleDeleteMeal = async (id: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('meals')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting meal:', error);
      alert('Failed to delete meal.');
    } else {
      setMeals(meals.filter(m => m.id !== id));
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddInput.trim() || !selectedMeal) return;

    const input = quickAddInput.trim();
    // Regex: name followed by space and then digits (optionally followed by g/pcs)
    const match = input.match(/^(.*?)\s+(\d+)(?:g|pcs|db)?$/i);
    let name = input;
    let grams = 100;

    if (match) {
      name = match[1].trim();
      grams = parseInt(match[2], 10);
    }

    // Search for food: exact match first, then partial
    const targetFood = foods.find(f => 
      (f.name_hu || '').toLowerCase() === name.toLowerCase() || 
      (f.name_en || '').toLowerCase() === name.toLowerCase()
    ) || foods.find(f => 
      (f.name_hu || '').toLowerCase().includes(name.toLowerCase()) || 
      (f.name_en || '').toLowerCase().includes(name.toLowerCase())
    );

    if (!targetFood) {
      showToast(`Food not found: ${name}`, 'error');
      return;
    }

    // Immutable update: Append new item
    const updatedMeal = {
      ...selectedMeal,
      items: [...(selectedMeal.items || []), {
        foodId: targetFood.id,
        quantityGrams: grams
      }]
    };

    try {
      await handleSaveMeal(updatedMeal);
      setQuickAddInput('');
      showToast(`Quick added ${targetFood.name_hu}`, 'success');
    } catch (err) {
      console.error('Quick Add failed:', err);
    }
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={48} />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (isRecoveryMode) {
    return <UpdatePassword onComplete={() => setIsRecoveryMode(false)} />;
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-sans flex flex-col pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-0">
      {/* App Top Navigation (Desktop) */}
      <nav className="hidden lg:flex w-full bg-white border-b border-border px-6 py-4 items-center justify-between sticky top-0 z-50">
        {/* LEFT */}
        <div className="flex items-center gap-3">
          <button onClick={() => { setEditingMeal(null); setIsMealModalOpen(true); }} className="flex items-center gap-2 bg-ink text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-black transition-transform active:scale-95 shadow-sm">
            <Plus size={18} />
            Add Meal
          </button>
          <button onClick={() => setIsDuplicateDayModalOpen(true)} className="flex items-center gap-2 bg-gray-50 text-ink px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-100 transition-colors border border-border">
            <Copy size={18} />
            Copy Day
          </button>
        </div>

        {/* CENTER */}
        <div className="flex items-center gap-1 bg-gray-50 p-1.5 rounded-2xl border border-border">
          <button onClick={() => setView('timeline')} className={cn("flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-[13px] transition-all", view === 'timeline' ? "bg-white text-ink shadow-sm" : "text-subtle hover:text-ink hover:bg-gray-100/50")}>
            <Clock size={16} />
            Dashboard
          </button>
          <button onClick={() => setView('statistics')} className={cn("flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-[13px] transition-all", view === 'statistics' ? "bg-white text-ink shadow-sm" : "text-subtle hover:text-ink hover:bg-gray-100/50")}>
            <BarChart2 size={16} />
            Statistics
          </button>
          <button onClick={() => setView('weight')} className={cn("flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-[13px] transition-all", view === 'weight' ? "bg-white text-ink shadow-sm" : "text-subtle hover:text-ink hover:bg-gray-100/50")}>
            <Scale size={16} />
            Weight
          </button>
        </div>

        {/* RIGHT */}
        <div className="flex items-center gap-2">
          <button onClick={() => setIsExportModalOpen(true)} className="flex items-center gap-2 text-subtle hover:text-ink p-2.5 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-border" title="Export Data">
            <Download size={18} />
          </button>
          <button onClick={handleLogout} className="flex items-center gap-2 text-subtle hover:text-red-500 p-2.5 rounded-xl hover:bg-red-50 transition-colors border border-transparent hover:border-red-100" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Desktop Header for Timeline (Dashboard) */}
      {view === 'timeline' && (
      <header className="hidden lg:flex bg-card border-b border-border px-6 py-6 sm:px-16 flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
        <div className="title-group w-full sm:w-auto">
          <h1 className="text-[14px] uppercase tracking-[0.1em] text-subtle font-bold mb-2">
            Fiber Intake {selectedDate.toDateString() === new Date().toDateString() ? 'Today' : ''}
          </h1>
          <div className="text-[84px] font-[800] leading-[0.9] tracking-[-3px] mb-8">
            {dailyTotals.total_fiber.toFixed(1)}
            <span className="text-subtle text-[40px] tracking-[-1px] ml-2">/ 35g</span>
          </div>

          {/* Date Selector Strip */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mt-4">
            <DayStrip selectedDate={selectedDate} onSelect={setSelectedDate} onOpenPicker={() => setIsDatePickerOpen(true)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-8 pb-2">
          <StatCard label="Calories" value={Math.round(dailyTotals.calories).toLocaleString()} unit="" />
          <StatCard label="Carbs" value={Math.round(dailyTotals.carbs)} unit="g" />
          <StatCard label="Protein" value={Math.round(dailyTotals.protein)} unit="g" />
          <StatCard label="Fat" value={Math.round(dailyTotals.fat)} unit="g" />
          <StatCard label="GL" value={Math.round(dailyTotals.gl)} unit="" highlight />
        </div>
      </header>
      )}
      {/* Mobile header: card-based summary + actions */}
      <div className="lg:hidden sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-3 pt-2 pb-2.5">
          <div className="rounded-[22px] border border-border bg-white shadow-sm overflow-hidden">
            <div className="px-3 pt-3 pb-2.5 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">
                    Fiber intake {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEE, MMM d')}
                  </div>
                  <div className="mt-1 flex items-end gap-2">
                    <span className="text-[30px] font-[800] tracking-[-0.04em] leading-none text-ink">
                      {dailyTotals.total_fiber.toFixed(1)}
                    </span>
                    <span className="pb-0.5 text-[12px] font-semibold text-subtle">/ 35g</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSelectedDate(new Date());
                    setView('timeline');
                  }}
                  className={cn(
                    'shrink-0 h-9 rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.12em] border transition-colors',
                    isToday(selectedDate)
                      ? 'bg-ink text-white border-ink'
                      : 'bg-white text-ink border-border hover:border-accent/40'
                  )}
                >
                  Today
                </button>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.14em] text-subtle">
                  <span>Progress</span>
                  <span>{Math.round(mobileFiberProgress)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${mobileFiberProgress}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <MobileStatTile label="Calories" value={Math.round(dailyTotals.calories).toLocaleString()} unit="kcal" />
                <MobileStatTile label="Protein" value={Math.round(dailyTotals.protein)} unit="g" />
                <MobileStatTile label="Fat" value={Math.round(dailyTotals.fat)} unit="g" />
                <MobileStatTile label="GL" value={Math.round(dailyTotals.gl)} unit="" accent />
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button
                  onClick={() => openExportModal('today')}
                  className="flex h-10 items-center justify-center gap-2 rounded-2xl border border-ink bg-ink px-4 text-[13px] font-bold text-white transition-colors hover:bg-black"
                >
                  <Download size={16} />
                  Export
                </button>
                <button
                  onClick={() => setMobileActionMenu(prev => prev === 'more' ? null : 'more')}
                  aria-expanded={mobileActionMenu === 'more'}
                  className="flex h-10 items-center justify-center gap-2 rounded-2xl border border-border bg-white px-3 text-[13px] font-bold text-ink transition-colors hover:border-accent/40"
                >
                  <MoreHorizontal size={16} />
                  More
                </button>
              </div>

              <AnimatePresence>
                {mobileActionMenu === 'more' && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="relative z-20 overflow-hidden rounded-3xl border border-border bg-white shadow-2xl"
                  >
                    <div className="grid grid-cols-1 divide-y divide-border/70">
                      <button
                        onClick={() => {
                          setMobileActionMenu(null);
                          openExportModal('today');
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <SlidersHorizontal size={16} className="text-subtle" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">Range</div>
                          <div className="text-[11px] text-subtle">Open export range presets</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setMobileActionMenu(null);
                          void copySummaryForRange(buildExportRange('today'), 'Today summary copied to clipboard!');
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <Copy size={16} className="text-subtle" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">Copy today summary</div>
                          <div className="text-[11px] text-subtle">Current local day</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setMobileActionMenu(null);
                          void copySummaryForRange(buildExportRange('this_week'), 'This week summary copied to clipboard!');
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <Copy size={16} className="text-subtle" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">Copy this week summary</div>
                          <div className="text-[11px] text-subtle">Monday to Sunday</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setMobileActionMenu(null);
                          setIsDuplicateDayModalOpen(true);
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <Calendar size={16} className="text-subtle" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">Duplicate meals</div>
                          <div className="text-[11px] text-subtle">Copy the selected day</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setMobileActionMenu(null);
                          setView('database');
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <UtensilsCrossed size={16} className="text-subtle" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ink">Browse foods</div>
                          <div className="text-[11px] text-subtle">Open the food database</div>
                        </div>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="border-t border-border/70 bg-[#FBFCFE] px-2 pb-2">
              <DayStrip selectedDate={selectedDate} onSelect={setSelectedDate} onOpenPicker={() => setIsDatePickerOpen(true)} />
            </div>
          </div>
        </div>
      </div>

      <main className={cn(
        "flex-1 overflow-hidden",
        view === 'timeline' ? "lg:grid lg:grid-cols-[1fr_360px]" : "max-w-6xl mx-auto w-full p-6"
      )}>
        {view === 'statistics' ? (
          <StatisticsView 
            userId={user.id}
            meals={statsMeals} 
            foods={foods} 
            days={statsDays} 
            setDays={setStatsDays}
            isLoading={isStatsLoading}
          />
        ) : view === 'weight' ? (
          <WeightView 
            userId={user.id}
            selectedDate={selectedDate}
            meals={statsMeals}
            foods={foods}
            onOpenExportModal={openExportModal}
          />
        ) : view === 'timeline' ? (
          <>
            {/* === MOBILE: Chronological list === */}
            <div className="lg:hidden overflow-y-auto bg-bg">
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="animate-spin text-accent" size={32} />
                </div>
              ) : sortedMeals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mb-6">
                    <Clock size={32} className="text-subtle/30" />
                  </div>
                  <h3 className="text-ink font-bold text-lg mb-2">No meals logged yet</h3>
                  <p className="text-subtle text-sm max-w-[200px] leading-relaxed mb-8">
                    Track your fiber intake by adding your first meal of the day.
                  </p>
                  <button
                    onClick={() => setIsMealModalOpen(true)}
                    className="flex items-center gap-2 px-8 py-3 bg-ink text-white rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-sm hover:shadow-md"
                  >
                    <Plus size={18} />
                    Add Meal
                  </button>
                </div>
              ) : (
                <div className="relative px-4 pt-2 pb-[calc(9rem+env(safe-area-inset-bottom))]">
                  {/* Vertical Timeline Line */}
                  <div className="absolute left-[30px] top-5 bottom-28 w-[2px] bg-border/40" />
                  
                  <div className="flex flex-col gap-2 relative">
                    {(() => {
                      const elements: React.ReactNode[] = [];
                      const now = new Date();
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      let indicatorAdded = false;

                      sortedMeals.forEach((meal, index) => {
                        const [mH, mM] = meal.time.split(':').map(Number);
                        const mealMin = mH * 60 + mM;

                        // Add "Now" indicator if this is the first meal in the future
                        if (!indicatorAdded && isToday(selectedDate) && mealMin > nowMin) {
                          elements.push(
                            <div key="now-indicator-mobile" ref={nowIndicatorRef} className="py-2 flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full bg-accent animate-pulse ml-[9px] relative z-10" />
                              <span className="text-[10px] font-bold text-accent uppercase tracking-widest">Now</span>
                              <div className="h-px bg-accent/20 flex-1" />
                            </div>
                          );
                          indicatorAdded = true;
                        }

                        let gapType: 'none' | 'medium' | 'large' = 'none';
                        if (index > 0) {
                          const prevMealTime = sortedMeals[index - 1].time.split(':').map(Number);
                          const diffInMinutes = (mH * 60 + mM) - (prevMealTime[0] * 60 + prevMealTime[1]);
                          if (diffInMinutes >= 240) gapType = 'large';
                          else if (diffInMinutes >= 120) gapType = 'medium';
                        }

                        elements.push(
                          <React.Fragment key={meal.id}>
                            {gapType === 'medium' && <div className="h-4" />}
                            {gapType === 'large' && (
                              <div className="py-4 flex items-center gap-4 opacity-10">
                                <div className="h-px bg-ink flex-1" />
                                <div className="h-px bg-ink flex-1" />
                              </div>
                            )}
                            <MealCard
                              meal={meal}
                              foods={foods}
                              isSelected={String(meal.id) === selectedMealId}
                              onClick={() => setSelectedMealId(sel => sel === String(meal.id) ? null : String(meal.id))}
                              onEdit={() => { setEditingMeal(meal); setIsMealModalOpen(true); }}
                              onDelete={() => handleDeleteMeal(String(meal.id))}
                              onDuplicate={() => { setMealToDuplicate(meal); setIsDuplicateModalOpen(true); }}
                            />
                          </React.Fragment>
                        );
                      });

                      // If "Now" is after all meals
                      if (!indicatorAdded && isToday(selectedDate)) {
                        elements.push(
                          <div key="now-indicator-bottom-mobile" ref={nowIndicatorRef} className="py-2 flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-accent animate-pulse ml-[9px] relative z-10" />
                            <span className="text-[10px] font-bold text-accent uppercase tracking-widest">Now</span>
                            <div className="h-px bg-accent/20 flex-1" />
                          </div>
                        );
                      }

                      return elements;
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* === DESKTOP: Chronological list === */}
            <div className="hidden lg:block p-8 border-r border-border bg-bg overflow-y-auto">
              {sortedMeals.length === 0 && !isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 text-center">
                  <div className="w-20 h-20 bg-gray-50 rounded-[2.5rem] flex items-center justify-center mb-8">
                    <Clock size={40} className="text-subtle/20" />
                  </div>
                  <h3 className="text-ink font-bold text-xl mb-3">No meals tracked for this day</h3>
                  <p className="text-subtle text-sm max-w-[280px] leading-relaxed mb-10">
                    Your timeline is empty. Start your daily fiber tracker by logging a new meal.
                  </p>
                  <button
                    onClick={() => setIsMealModalOpen(true)}
                    className="flex items-center gap-2 px-10 py-4 bg-ink text-white rounded-2xl font-bold text-[15px] transition-all active:scale-95 shadow-lg shadow-ink/10 hover:shadow-xl hover:shadow-ink/20 hover:-translate-y-0.5"
                  >
                    <Plus size={20} />
                    Add Your First Meal
                  </button>
                </div>
              ) : (
                <div className="relative px-12 pt-4 pb-28">
                  {/* Vertical Timeline Line */}
                  <div className="absolute left-[88px] top-6 bottom-32 w-[2px] bg-border/30" />

                  <div className="flex flex-col gap-2 relative">
                    {(() => {
                      const elements: React.ReactNode[] = [];
                      const now = new Date();
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      let indicatorAdded = false;

                      sortedMeals.forEach((meal, index) => {
                        const [mH, mM] = meal.time.split(':').map(Number);
                        const mealMin = mH * 60 + mM;

                        // Add "Now" indicator if this is the first meal in the future
                        if (!indicatorAdded && isToday(selectedDate) && mealMin > nowMin) {
                          elements.push(
                            <div key="now-indicator-desktop" ref={nowIndicatorRef} className="py-2 flex items-center gap-4">
                              <div className="w-3 h-3 rounded-full bg-accent animate-pulse ml-[35px] relative z-10 border-4 border-bg" />
                              <span className="text-[11px] font-bold text-accent uppercase tracking-widest">Current Time</span>
                              <div className="h-px bg-accent/20 flex-1 pr-12" />
                            </div>
                          );
                          indicatorAdded = true;
                        }

                        let gapType: 'none' | 'medium' | 'large' = 'none';
                        if (index > 0) {
                          const prevMealTime = sortedMeals[index - 1].time.split(':').map(Number);
                          const diffInMinutes = (mH * 60 + mM) - (prevMealTime[0] * 60 + prevMealTime[1]);
                          if (diffInMinutes >= 240) gapType = 'large';
                          else if (diffInMinutes >= 120) gapType = 'medium';
                        }

                        elements.push(
                          <React.Fragment key={meal.id}>
                            {gapType === 'medium' && <div className="h-6" />}
                            {gapType === 'large' && (
                              <div className="py-8 flex items-center gap-4 opacity-20">
                                <div className="h-px bg-ink flex-1" />
                                <Clock size={16} className="text-ink" />
                                <div className="h-px bg-ink flex-1" />
                              </div>
                            )}
                            <MealBlock
                              meal={meal}
                              foods={foods}
                              isSelected={String(meal.id) === selectedMealId}
                              onClick={() => setSelectedMealId(sel => sel === String(meal.id) ? null : String(meal.id))}
                              onEdit={() => {
                                setEditingMeal(meal);
                                setIsMealModalOpen(true);
                              }}
                              onDelete={() => handleDeleteMeal(String(meal.id))}
                              onDuplicate={() => {
                                setMealToDuplicate(meal);
                                setIsDuplicateModalOpen(true);
                              }}
                            />
                          </React.Fragment>
                        );
                      });

                      // If "Now" is after all meals
                      if (!indicatorAdded && isToday(selectedDate)) {
                        elements.push(
                          <div key="now-indicator-bottom-desktop" ref={nowIndicatorRef} className="py-2 flex items-center gap-4">
                            <div className="w-3 h-3 rounded-full bg-accent animate-pulse ml-[35px] relative z-10 border-4 border-bg" />
                            <span className="text-[11px] font-bold text-accent uppercase tracking-widest">Current Time</span>
                            <div className="h-px bg-accent/20 flex-1 pr-12" />
                          </div>
                        );
                      }

                      return elements;
                    })()}
                  </div>
                </div>
              )}
            </div>


            {/* Detail Panel / Sidebar (desktop only) */}
            <aside className="hidden lg:flex flex-col bg-card p-10 gap-8 overflow-y-auto border-l border-border">
              <div className="detail-header">
                <h2 className="text-[24px] font-[800] tracking-[-0.5px]">Meal Details</h2>
                <p className="text-subtle text-[13px] mt-1">Select a meal to see breakdown</p>
              </div>

              {selectedMeal ? (() => {
                const meal = selectedMeal;
                const mealItems = (meal.items || []).map(item => ({
                  food: getFoodOrUnknown(foods, item.foodId || ''),
                  quantity: item.quantityGrams,
                  customMacros: item
                }));
                const totals = calculateMealTotals(mealItems);

                return (
                  <div className="space-y-8">
                    <div className="bg-gray-50 p-4 rounded-xl border border-border flex justify-between items-baseline group relative">
                      <div>
                        <h3 className="font-bold text-lg">{meal.name}</h3>
                        <p className="text-xs text-subtle font-mono">{meal.time}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingMeal(meal); setIsMealModalOpen(true); }}
                          className="p-2 text-subtle hover:text-ink hover:bg-black/5 rounded-lg transition-all active:scale-90"
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => { setMealToDuplicate(meal); setIsDuplicateModalOpen(true); }}
                          className="p-2 text-subtle hover:text-ink hover:bg-black/5 rounded-lg transition-all active:scale-90"
                          title="Duplicate"
                        >
                          <Copy size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteMeal(meal.id)}
                          className="p-2 text-subtle hover:text-red-500 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-xl border border-border flex justify-between items-center">
                      <div className="flex gap-6">
                        <div className="text-center">
                          <div className="text-lg font-bold text-ink">{Math.round(totals.protein)}g</div>
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Protein</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-ink">{Math.round(totals.carbs)}g</div>
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Carbs</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-ink">{Math.round(totals.fat)}g</div>
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fat</div>
                        </div>
                      </div>
                      <div className="h-10 w-px bg-gray-200" />
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-ink">{Math.round(totals.calories)}</div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">kcal</div>
                      </div>
                    </div>

                    {/* Quick Add Input */}
                    <form onSubmit={handleQuickAdd} className="relative group/qa">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle/30 group-focus-within/qa:text-accent transition-colors">
                        <Plus size={16} strokeWidth={3} />
                      </div>
                      <input 
                        type="text"
                        value={quickAddInput}
                        onChange={e => setQuickAddInput(e.target.value)}
                        placeholder="Quick Add (e.g. rice 100g)"
                        className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-border rounded-xl text-[13px] font-medium focus:bg-white focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all outline-none"
                      />
                      {quickAddInput && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-subtle/40 uppercase tracking-widest">
                          Press Enter
                        </div>
                      )}
                    </form>

                    <div className="bg-[#F1F5F9] p-4 rounded-xl space-y-2">
                       <div className="flex justify-between text-[13px]">
                         <span className="text-[#64748B]">Soluble Fiber</span>
                         <span className="font-semibold">{totals.soluble_fiber.toFixed(1)}g</span>
                       </div>
                       <div className="flex justify-between text-[13px]">
                         <span className="text-[#64748B]">Insoluble Fiber</span>
                         <span className="font-semibold">{totals.insoluble_fiber.toFixed(1)}g</span>
                       </div>
                       <div className="flex justify-between text-[13px] border-t border-[#CBD5E1] pt-2 mt-1">
                         <span className="font-bold text-ink">Total Fiber</span>
                         <span className="font-bold text-accent">{totals.total_fiber.toFixed(1)}g</span>
                       </div>
                    </div>

                    <ul className="space-y-0">
                      {mealItems.map((item, i) => (
                        <li key={i} className="flex justify-between items-center py-3 border-b border-border last:border-0">
                          <div className="flex-1 min-w-0 pr-4">
                            <h4 className={cn("text-[14px]", (!item.food.isDeleted || item.customMacros?.is_custom) ? "font-semibold" : "text-red-500 italic")}>
                              {item.customMacros?.is_custom ? item.customMacros.name : item.food.name_hu}
                              {item.food.brand && <span className="text-[11px] text-gray-400 font-normal ml-1">({item.food.brand})</span>}
                              {item.food.name_en && <span className="text-xs text-gray-500 ml-1 font-normal opacity-70">({item.food.name_en})</span>}
                              {item.food.gi != null && <span className={cn("ml-2 font-bold", item.food.gi < 56 ? "text-green-600" : item.food.gi < 70 ? "text-yellow-600" : "text-red-500")}>(GI: {item.food.gi})</span>}
                            </h4>
                            <div className="text-[13px] text-gray-500 mt-0.5">
                              {item.quantity}g
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold text-[14px]">
                              {(item.food.total_fiber * item.quantity / 100).toFixed(1)}g
                            </div>
                            {item.food.gi != null && (
                              <div className="text-[10px] text-subtle font-bold">
                                GL: {Math.round((item.food.gi * item.food.carbs * item.quantity) / 10000)}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })() : (
                <div className="flex-1 flex flex-col items-center justify-center text-subtle text-sm h-64">
                  <Clock size={40} className="mb-3 opacity-20" />
                  <span className="italic">{sortedMeals.length > 0 ? "Select a meal on the timeline" : "No meals logged today"}</span>
                  {sortedMeals.length === 0 && (
                     <button
                       onClick={() => { setEditingMeal(null); setIsMealModalOpen(true); }}
                       className="mt-4 px-6 py-2 bg-black/5 hover:bg-black/10 rounded-full font-semibold transition-colors uppercase tracking-widest text-[10px]"
                     >
                       Create First Meal
                     </button>
                  )}
                </div>
              )}
              
              <button
                onClick={() => {
                  setEditingMeal(null);
                  setIsMealModalOpen(true);
                }}
                className="mt-auto bg-ink text-white py-4 rounded-xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-black transition-colors active:scale-[0.98]"
              >
                Add New Meal
              </button>
              <p className="text-center text-[10px] text-subtle uppercase tracking-[1px]">
                Powered by Supabase
              </p>
            </aside>
          </>
        ) : (
          <FoodDatabase
            foods={foods}
            setFoods={setFoods}
            sheetUrl={sheetUrl}
            setSheetUrl={setSheetUrl}
            isLoading={isLoading}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav view={view} onChange={setView} />

      {/* Floating Action Button */}
      {view === 'timeline' && (
        <button
          onClick={() => {
            setEditingMeal(null);
            setIsMealModalOpen(true);
          }}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 sm:right-8 w-14 h-14 bg-green-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-green-700 transition-transform active:scale-95 z-50 lg:bottom-8"
        >
          <Plus size={28} />
        </button>
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]"
          >
            <div className={cn("px-4 py-3 rounded-full shadow-xl text-sm font-bold flex items-center gap-2", toastMessage.type === 'success' ? "bg-[#DCFCE7] text-[#166534]" : "bg-red-100 text-red-700")}>
              {toastMessage.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {isMealModalOpen && (
          <MealModal
            isOpen={isMealModalOpen}
            onClose={() => setIsMealModalOpen(false)}
            onSave={handleSaveMeal}
            editingMeal={editingMeal}
            foods={foods}
            existingMeals={meals}
          />
        )}
        {isDuplicateModalOpen && mealToDuplicate && (
          <DuplicateMealModal
            isOpen={isDuplicateModalOpen}
            onClose={() => setIsDuplicateModalOpen(false)}
            meal={mealToDuplicate}
            onDuplicate={handleDuplicateMeal}
          />
        )}
        {isDuplicateDayModalOpen && (
          <DuplicateDayModal
            isOpen={isDuplicateDayModalOpen}
            onClose={() => setIsDuplicateDayModalOpen(false)}
            mealCount={meals.length}
            onDuplicate={handleDuplicateDay}
          />
        )}
        {isExportModalOpen && (
          <UnifiedExportModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            user_id={user?.id || ''}
            foods={foods}
            initialRange={exportModalRange}
            initialDataType={exportModalDataType}
            initialFormat={exportModalFormat}
            showToast={showToast}
          />
        )}
      </AnimatePresence>

      <DatePickerModal
        isOpen={isDatePickerOpen}
        onClose={() => setIsDatePickerOpen(false)}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
      />
    </div>
  );
}

function UpdatePassword({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage({ type: 'error', text: getFriendlyErrorMessage(error) });
      setLoading(false);
    } else {
      setMessage({ type: 'success', text: 'Password successfully updated!' });
      setTimeout(() => onComplete(), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm bg-card p-10 rounded-[32px] border border-border shadow-2xl space-y-8">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-4">
             <Lock size={32} strokeWidth={2.5} />
          </div>
          <h1 className="text-[24px] font-[800] tracking-[-1px] leading-tight">New Password</h1>
          <p className="text-subtle text-[14px]">Enter your new password below</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle/50" size={18} />
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink" />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-ink text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-black transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="animate-spin" size={20} /> : 'Save Password'}
          </button>
        </form>
        {message && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className={cn("p-4 rounded-2xl text-[13px] font-medium text-center", message.type === 'success' ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100")}>
            {message.text}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

function Login() {
  useEffect(() => {
    console.log("PASSWORD LOGIN RENDERED");
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (isForgotPasswordMode) {
      if (!email) {
        setMessage({ type: 'error', text: 'Email is required' });
        setLoading(false);
        return;
      }
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      
      if (error) {
        setMessage({ type: 'error', text: getFriendlyErrorMessage(error) });
      } else {
        setMessage({ type: 'success', text: 'Password reset link sent to your email.' });
      }
      setLoading(false);
      return;
    }

    if (!email || !password) {
      setMessage({ type: 'error', text: 'Email and password are required' });
      setLoading(false);
      return;
    }

    console.log(`[Auth] Attempting ${isLoginMode ? 'login' : 'signup'} with password...`);

    let error = null;
    let data: any = null;

    if (isLoginMode) {
      const resp = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      error = resp.error;
      data = resp.data;
    } else {
      const resp = await supabase.auth.signUp({
        email,
        password,
      });
      error = resp.error;
      data = resp.data;
    }

    if (error) {
      setMessage({ type: 'error', text: getFriendlyErrorMessage(error) });
    } else {
      if (!isLoginMode && data?.user && !data?.session) {
        setMessage({ type: 'success', text: 'Account created! Please check your email to confirm.' });
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-card p-10 rounded-[32px] border border-border shadow-2xl space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Clock size={32} strokeWidth={2.5} />
          </div>
          <h1 className="text-[32px] font-[800] tracking-[-1px] leading-tight">FiberTrack</h1>
          <p className="text-subtle text-[14px]">Simple daily fiber tracking</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle/50" size={18} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink"
                />
              </div>
            </div>
            
            {!isForgotPasswordMode && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle/50" size={18} />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-black transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : (isForgotPasswordMode ? 'Send Reset Link' : (isLoginMode ? 'Sign In' : 'Create Account'))}
          </button>
        </form>

        {message && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className={cn(
              "p-4 rounded-2xl text-[13px] font-medium text-center",
              message.type === 'success' ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
            )}
          >
            {message.text}
          </motion.div>
        )}

        <div className="pt-4 border-t border-border flex flex-col items-center gap-3">
          {!isForgotPasswordMode && (
             <button
               type="button"
               onClick={() => {
                 setIsForgotPasswordMode(true);
                 setMessage(null);
               }}
               className="text-[12px] font-bold text-subtle hover:text-ink transition-colors"
             >
               Forgot password?
             </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (isForgotPasswordMode) {
                setIsForgotPasswordMode(false);
              } else {
                setIsLoginMode(!isLoginMode);
              }
              setMessage(null);
            }}
            className="text-[12px] font-bold text-subtle hover:text-ink transition-colors"
          >
            {isForgotPasswordMode 
              ? "Back to Sign In" 
              : (isLoginMode ? "Don't have an account? Sign up" : "Already have an account? Sign in")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  unit: string;
  highlight?: boolean;
  small?: boolean;
}

function StatCard({ label, value, unit, highlight = false, small = false }: StatCardProps) {
  return (
    <div className={cn("flex flex-col", highlight && "text-accent")}>
      <span className={cn(
        "font-[800] tracking-tight text-ink", 
        small ? "text-[20px]" : "text-[28px]"
      )}>
        {value}<span className={cn("font-semibold text-subtle ml-[2px]", small ? "text-[13px]" : "text-[16px]")}>{unit}</span>
      </span>
      <span className="text-[10px] uppercase text-subtle/70 font-bold tracking-widest">{label}</span>
    </div>
  );
}

function MobileStatTile({ label, value, unit, accent = false }: { label: string; value: string | number; unit: string; accent?: boolean }) {
  return (
    <div className={cn(
      "flex min-w-[calc(50%-0.375rem)] flex-1 items-center justify-between gap-2 rounded-full border px-3 py-2 bg-gray-50",
      accent ? "border-accent/25 bg-accent/5" : "border-border"
    )}>
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-subtle">{label}</div>
      <div className={cn("text-[15px] font-[800] leading-none", accent ? "text-accent" : "text-ink")}>
        {value}
        {unit ? <span className="ml-1 text-[10px] font-semibold text-subtle">{unit}</span> : null}
      </div>
    </div>
  );
}

function MobileBottomNav({
  view,
  onChange,
}: {
  view: 'timeline' | 'database' | 'statistics' | 'weight';
  onChange: (view: 'timeline' | 'database' | 'statistics' | 'weight') => void;
}) {
  const tabs = [
    { id: 'timeline' as const, label: 'Dashboard', icon: Clock },
    { id: 'statistics' as const, label: 'Statistics', icon: BarChart2 },
    { id: 'weight' as const, label: 'Weight', icon: Scale },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white/95 backdrop-blur-xl pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.06)]">
      <div className="mx-auto grid max-w-2xl grid-cols-3 gap-1 px-2">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = view === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-bold transition-colors",
                active ? "text-accent bg-accent/8" : "text-subtle hover:text-ink hover:bg-gray-50"
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface DuplicateMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  meal: Meal;
  onDuplicate: (meal: Meal, date: string, time: string) => Promise<void>;
}

function DuplicateMealModal({ isOpen, onClose, meal, onDuplicate }: DuplicateMealModalProps) {
  const [targetDate, setTargetDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [targetTime, setTargetTime] = useState(meal.time);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative w-full max-w-sm bg-white rounded-[32px] shadow-2xl p-8 space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Copy size={32} strokeWidth={2.5} />
          </div>
          <h3 className="text-[24px] font-[800] tracking-[-1px] leading-tight">Duplicate Meal</h3>
          <p className="text-subtle text-[14px]">Copying "{meal.name}" to another date</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Target Date</label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/40" size={18} />
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Target Time</label>
            <div className="relative">
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/40" size={18} />
              <input
                type="time"
                value={targetTime}
                onChange={e => setTargetTime(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={async () => {
              setIsSaving(true);
              await onDuplicate(meal, targetDate, targetTime);
              setIsSaving(false);
            }}
            disabled={isSaving}
            className="w-full bg-accent text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-green-700 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="animate-spin" size={20} /> : 'Duplicate Meal'}
          </button>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="w-full bg-gray-100 text-ink py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-gray-200 transition-all active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

interface DuplicateDayModalProps {
  isOpen: boolean;
  onClose: () => void;
  mealCount: number;
  onDuplicate: (date: string, keepTimes: boolean) => Promise<void>;
}

function DuplicateDayModal({ isOpen, onClose, mealCount, onDuplicate }: DuplicateDayModalProps) {
  const [targetDate, setTargetDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [keepTimes, setKeepTimes] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative w-full max-w-sm bg-white rounded-[32px] shadow-2xl p-8 space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Copy size={32} strokeWidth={2.5} />
          </div>
          <h3 className="text-[24px] font-[800] tracking-[-1px] leading-tight">Duplicate Day</h3>
          <p className="text-subtle text-[14px]">Copying {mealCount} meals to another date</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Target Date</label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/40" size={18} />
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 px-1">
            <input
              type="checkbox"
              id="keepTimes"
              checked={keepTimes}
              onChange={e => setKeepTimes(e.target.checked)}
              className="w-5 h-5 rounded-md border-gray-300 text-accent focus:ring-accent accent-accent"
            />
            <label htmlFor="keepTimes" className="text-[14px] font-semibold text-ink cursor-pointer">
              Keep original meal times
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={async () => {
              setIsSaving(true);
              await onDuplicate(targetDate, keepTimes);
              setIsSaving(false);
            }}
            disabled={isSaving}
            className="w-full bg-accent text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-green-700 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="animate-spin" size={20} /> : 'Duplicate Everything'}
          </button>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="w-full bg-gray-100 text-ink py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-gray-200 transition-all active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Mobile expandable card ───────────────────────────────────────────────────
interface MealCardProps {
  meal: Meal;
  foods: Food[];
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function MealCard({ meal, foods, isSelected, onClick, onEdit, onDelete, onDuplicate }: MealCardProps) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [mealH, mealM] = meal.time.split(':').map(Number);
  const mealMinutes = mealH * 60 + mealM;
  const isNow = Math.abs(nowMinutes - mealMinutes) < 30;

  const mealItems = (meal.items || []).map(item => ({
    food: getFoodOrUnknown(foods, item.foodId || ''),
    quantity: item.quantityGrams,
    customMacros: item
  }));
  const totals = calculateMealTotals(mealItems);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border transition-all duration-200 overflow-hidden',
        isSelected
          ? 'border-accent bg-white shadow-md ring-2 ring-accent/20'
          : 'border-border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md active:scale-[0.99]'
      )}
    >
      {/* Card header – always visible */}
      <button
        className="w-full text-left p-4"
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[11px] font-bold text-subtle/70 font-mono uppercase tracking-[0.14em]">{meal.time}</span>
              {isNow && (
                <span className="text-[10px] font-bold bg-accent text-white px-2 py-0.5 rounded-full whitespace-nowrap">Now</span>
              )}
            </div>
            <h3 className="text-[16px] font-bold text-ink leading-snug break-words">
              {meal.name}
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[11px] font-bold bg-[#DCFCE7] text-[#166534] px-2.5 py-1 rounded-full whitespace-nowrap">{totals.total_fiber.toFixed(1)}g fiber</span>
              <span className={cn("text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 whitespace-nowrap", getGlycemicLoadLabel(totals.gl).color)}>
                GL: {Math.round(totals.gl)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-subtle">
              <span>{Math.round(totals.calories)} kcal</span>
              <span>{Math.round(totals.protein)}g protein</span>
              <span>{Math.round(totals.carbs)}g carbs</span>
              <span>{Math.round(totals.fat)}g fat</span>
            </div>
          </div>
          <ChevronRight
            size={18}
            className={cn('text-subtle flex-shrink-0 transition-transform duration-200 mt-1', isSelected && 'rotate-90')}
          />
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
              {/* Macros grid */}
              <div className="flex justify-between items-center bg-gray-50 rounded-xl p-3 px-4">
                <div className="flex gap-4">
                  <div className="text-center">
                    <div className="text-[14px] font-[800] text-ink">{Math.round(totals.protein)}g</div>
                    <div className="text-[9px] text-subtle uppercase tracking-widest font-bold">Protein</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] font-[800] text-ink">{Math.round(totals.carbs)}g</div>
                    <div className="text-[9px] text-subtle uppercase tracking-widest font-bold">Carbs</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] font-[800] text-ink">{Math.round(totals.fat)}g</div>
                    <div className="text-[9px] text-subtle uppercase tracking-widest font-bold">Fat</div>
                  </div>
                </div>
                <div className="h-8 w-px bg-gray-200" />
                <div className="flex gap-4">
                  <div className="text-center">
                    <div className="text-[14px] font-[800] text-accent">{totals.total_fiber.toFixed(1)}g</div>
                    <div className="text-[9px] text-subtle uppercase tracking-widest font-bold">Fiber</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] font-[800] text-ink">{Math.round(totals.gl)}</div>
                    <div className="text-[9px] text-subtle uppercase tracking-widest font-bold">GL</div>
                  </div>
                </div>
              </div>

              {/* Food list */}
              <ul className="space-y-1">
                {mealItems.map((item, i) => (
                  <li key={i} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-[13px] font-semibold', (item.food.isDeleted && !item.customMacros?.is_custom) && 'text-red-400 italic')}>
                        {item.customMacros?.is_custom ? item.customMacros.name : item.food.name_hu}
                        {item.food.brand && <span className="text-[11px] text-gray-400 font-normal ml-1">({item.food.brand})</span>}
                        {item.food.name_en && (
                          <span className="text-gray-500 font-normal ml-1 text-xs">({item.food.name_en})</span>
                        )}
                        {item.food.gi != null && <span className={cn("ml-1 font-bold", item.food.gi < 56 ? "text-green-600" : item.food.gi < 70 ? "text-yellow-600" : "text-red-500")}>(GI: {item.food.gi})</span>}
                      </span>
                      <span className="text-[11px] text-subtle ml-2">{item.quantity}g</span>
                    </div>
                    <span className="font-mono text-[12px] font-bold text-accent text-right">
                      {(item.food.total_fiber * item.quantity / 100).toFixed(1)}g
                      {item.food.gi != null && (
                        <span className="block text-[9px] text-subtle font-bold">GL: {Math.round((item.food.gi * item.food.carbs * item.quantity) / 10000)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-[12px] font-bold transition-all active:scale-95"
                >
                  <Edit2 size={14} /> Edit
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-[12px] font-bold transition-all active:scale-95"
                >
                  <Copy size={14} /> Duplicate
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl text-[12px] font-bold transition-all active:scale-95"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Desktop timeline card ────────────────────────────────────────────────────
interface MealBlockProps {
  key?: string | number;
  meal: Meal;
  foods: Food[];
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function MealBlock({ meal, foods, isSelected, onClick, onEdit, onDelete, onDuplicate }: MealBlockProps) {
  const mealItems = (meal.items || []).map(item => ({
    food: getFoodOrUnknown(foods, item.foodId || ''),
    quantity: item.quantityGrams,
    customMacros: item
  }));

  const totals = calculateMealTotals(mealItems);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "bg-card border rounded-md p-3 transition-all duration-200 cursor-pointer group w-full max-w-md",
        isSelected
          ? "border-accent ring-2 ring-accent/20 shadow-md bg-accent/5 scale-[1.01]"
          : "border-border border-l-4 border-l-accent shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-md hover:bg-gray-50/80 hover:border-l-accent/80 hover:scale-[1.005] active:scale-[0.995]"
      )}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-[16px] font-bold">
            <span className="text-[11px] font-medium text-subtle/60 mr-3 font-mono uppercase transition-colors">{meal.time}</span>
            {meal.name}
          </h3>
          <div className="flex items-center gap-2 mt-2">
            <div className="inline-block text-[12px] font-semibold bg-[#DCFCE7] text-[#166534] px-2 py-0.5 rounded">
              {totals.total_fiber.toFixed(1)}g Fiber
            </div>
            <div className={cn("inline-block text-[12px] font-semibold px-2 py-0.5 rounded bg-gray-100", getGlycemicLoadLabel(totals.gl).color)}>
              GL: {Math.round(totals.gl)}
            </div>
            <div className="text-[12px] text-subtle ml-2">{Math.round(totals.calories)} kcal • {Math.round(totals.protein)}P {Math.round(totals.carbs)}C {Math.round(totals.fat)}F</div>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 text-subtle hover:text-ink hover:bg-black/5 rounded-md transition-all active:scale-90"
            title="Edit Meal"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="p-1.5 text-subtle hover:text-ink hover:bg-black/5 rounded-md transition-all active:scale-90"
            title="Duplicate Meal"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-subtle hover:text-red-500 hover:bg-red-50 rounded-md transition-all active:scale-90"
            title="Delete Meal"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

interface MealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (meal: Partial<Meal>) => Promise<void>;
  editingMeal: Meal | null;
  foods: Food[];
  existingMeals: Meal[];
}

function MealModal({ isOpen, onClose, onSave, editingMeal, foods, existingMeals }: MealModalProps) {
  const [name, setName] = useState(editingMeal?.name || '');
  const [time, setTime] = useState(editingMeal?.time || format(new Date(), 'HH:mm'));
  const [items, setItems] = useState<any[]>(editingMeal?.items || []);
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualForm, setManualForm] = useState({
    name: '',
    grams: '100',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    sugar: '',
    saturatedFat: '',
    totalFiber: '',
    solubleFiber: '',
    insolubleFiber: '',
    gi: '',
    isTotal: true
  });
  const quantityRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSaveClick = async () => {
    setErrorMsg(null);
    
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg("Meal name cannot be empty.");
      return;
    }

    const today = new Date().toDateString();

    const isDuplicate = existingMeals.some(m => {
      const mDate = (m as any).created_at ? new Date((m as any).created_at).toDateString() : today;
      const tDate = (editingMeal as any)?.created_at ? new Date((editingMeal as any).created_at).toDateString() : today;
      
      return mDate === tDate && 
             m.name.trim().toLowerCase() === trimmedName.toLowerCase() && 
             m.id !== editingMeal?.id;
    });

    console.log('[Validation] Form date assumptions -> editing_meal:', (editingMeal as any)?.created_at, 'today:', today);
    console.log('[Validation] isDuplicate check result:', isDuplicate);

    if (isDuplicate) {
      setErrorMsg("Meal with this name already exists today.");
      return;
    }

    if (items.length === 0) {
      setErrorMsg("Please add at least one food item.");
      return;
    }
    
    // Separate custom items and merge regular items
    const mergedRegularItemsMap = new Map<string, number>();
    const customItems: any[] = [];

    for (const item of items) {
      const qty = Number(item.quantityGrams);
      if (isNaN(qty) || qty <= 0) {
        setErrorMsg("All foods must have a valid quantity greater than 0g.");
        return;
      }
      
      if (item.is_custom) {
        customItems.push(item);
      } else if (item.foodId) {
        mergedRegularItemsMap.set(item.foodId, (mergedRegularItemsMap.get(item.foodId) || 0) + qty);
      }
    }

    const mergedRegularItems = Array.from(mergedRegularItemsMap.entries()).map(([foodId, quantityGrams]) => ({
      foodId, quantityGrams
    }));

    const finalItems = [...mergedRegularItems, ...customItems];

    setIsSaving(true);
    try {
      await onSave({
        ...(editingMeal ? { id: editingMeal.id } : {}),
        name: trimmedName,
        time,
        items: finalItems
      } as Meal);
    } catch (err: any) {
      setErrorMsg(getFriendlyErrorMessage(err));
      setIsSaving(false);
    }
  };

  // Food searching
  const filteredFoods = foods
    .filter(f => {
      const query = search.toLowerCase();
      return (f.name_hu || '').toLowerCase().includes(query) || 
             (f.brand && f.brand.toLowerCase().includes(query));
    })
    .slice(0, 50);

  console.log('SEARCH INPUT:', search);
  console.log('FILTERED FOODS:', filteredFoods);
  console.log('ALL FOODS IN MODAL:', foods.length);

  const addItem = (food: Food) => {
    setItems(prev => {
      const newItems = [...prev, { foodId: food.id, quantityGrams: 100 }];
      const idx = newItems.length - 1;
      setTimeout(() => {
        if (quantityRefs.current[idx]) {
          quantityRefs.current[idx]?.focus();
          quantityRefs.current[idx]?.select();
        }
      }, 50);
      return newItems;
    });
    setSearch('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (search && filteredFoods.length > 0) {
        addItem(filteredFoods[0]);
      }
    }
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, val: any) => {
    setItems(items.map((item, i) => i === index ? { ...item, quantityGrams: val } : item));
  };

  const handleAddManual = () => {
    const { name, grams, calories, protein, carbs, fat, sugar, saturatedFat, totalFiber, solubleFiber, insolubleFiber, gi, isTotal } = manualForm;
    if (!name || !calories || !protein || !carbs || !fat || !grams) {
      setErrorMsg("Please fill in name, grams, and all core macro fields.");
      return;
    }
    
    const qty = Number(grams);
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg("Grams must be a valid number greater than 0.");
      return;
    }

    const parseField = (value: string) => {
      if (value.trim() === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const caloriesValue = Number(calories);
    const proteinValue = Number(protein);
    const carbsValue = Number(carbs);
    const fatValue = Number(fat);
    if ([caloriesValue, proteinValue, carbsValue, fatValue].some(value => !Number.isFinite(value) || value < 0)) {
      setErrorMsg("Core macro fields must be 0 or greater.");
      return;
    }

    const providedTotalFiber = parseField(totalFiber);
    const providedSolubleFiber = parseField(solubleFiber);
    const providedInsolubleFiber = parseField(insolubleFiber);
    const providedSugar = parseField(sugar);
    const providedSaturatedFat = parseField(saturatedFat);
    const giValue = parseField(gi);

    if ([providedTotalFiber, providedSolubleFiber, providedInsolubleFiber, providedSugar, providedSaturatedFat, giValue].some(value => value !== null && value < 0)) {
      setErrorMsg("Fiber, sugar, saturated fat, and GI values must be 0 or greater.");
      return;
    }

    const hasSplitPair = providedSolubleFiber !== null && providedInsolubleFiber !== null;
    const derivedTotalFiber = providedTotalFiber !== null
      ? providedTotalFiber
      : hasSplitPair
        ? providedSolubleFiber + providedInsolubleFiber
        : null;

    if (providedTotalFiber === null && !hasSplitPair) {
      setErrorMsg("Enter total fiber or both soluble and insoluble fiber.");
      return;
    }

    const scale = isTotal ? (100 / qty) : 1;
    const totalFiberPer100g = derivedTotalFiber !== null ? derivedTotalFiber * scale : null;
    const solubleFiberPer100g = providedSolubleFiber !== null ? providedSolubleFiber * scale : null;
    const insolubleFiberPer100g = providedInsolubleFiber !== null ? providedInsolubleFiber * scale : null;
    const sugarPer100g = providedSugar !== null ? providedSugar * scale : null;
    const saturatedFatPer100g = providedSaturatedFat !== null ? providedSaturatedFat * scale : null;
    const newItem = {
      foodId: null,
      quantityGrams: qty,
      name: name,
      calories: caloriesValue * scale,
      protein: proteinValue * scale,
      carbs: carbsValue * scale,
      fat: fatValue * scale,
      sugar: sugarPer100g ?? undefined,
      saturated_fat: saturatedFatPer100g ?? undefined,
      fiber: totalFiberPer100g ?? 0,
      total_fiber: totalFiberPer100g ?? undefined,
      soluble_fiber: solubleFiberPer100g ?? undefined,
      insoluble_fiber: insolubleFiberPer100g ?? undefined,
      gi: giValue ?? undefined,
      is_custom: true
    };
    
    setItems(prev => [...prev, newItem]);
    setManualForm({ name: '', grams: '100', calories: '', protein: '', carbs: '', fat: '', sugar: '', saturatedFat: '', totalFiber: '', solubleFiber: '', insolubleFiber: '', gi: '', isTotal: true });
    setIsManualMode(false);
    setErrorMsg(null);
  };

  const mealTotals = useMemo(() => {
    const mealItems = items.map(item => ({
      food: item.is_custom ? undefined : getFoodOrUnknown(foods, item.foodId),
      quantity: Number(item.quantityGrams),
      customMacros: item
    }));
    return calculateMealTotals(mealItems);
  }, [items, foods]);

  const hasIncompleteFiberSplitSummary = items.some(item => {
    if (item.is_custom) {
      const totalFiber = item.total_fiber ?? item.fiber ?? 0;
      if (totalFiber <= 0) return false;
      return item.soluble_fiber == null || item.insoluble_fiber == null || ((item.soluble_fiber ?? 0) + (item.insoluble_fiber ?? 0) === 0);
    }

    if (!item.foodId) return false;
    const food = getFoodOrUnknown(foods, item.foodId);
    return food.total_fiber > 0 && (food.soluble_fiber + food.insoluble_fiber === 0);
  });
  const hasKnownFiberSplitSummary = mealTotals.total_fiber > 0 && !hasIncompleteFiberSplitSummary && (mealTotals.soluble_fiber + mealTotals.insoluble_fiber) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto overflow-x-hidden"
      >
        <form onSubmit={(e) => { e.preventDefault(); handleSaveClick(); }} className="flex flex-col min-h-0 w-full">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-[120]">
          <h2 className="text-xl font-bold">{editingMeal ? 'Edit Meal' : 'New Meal'}</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-visible p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Meal Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Breakfast"
                className="w-full px-4 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Time</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 transition-all"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Add Foods</label>
                <div className="flex bg-gray-100 p-0.5 rounded-lg shadow-inner">
                  <button type="button" onClick={() => setIsManualMode(false)} className={cn("px-4 py-1.5 text-[11px] font-bold rounded-md transition-all", !isManualMode ? "bg-white text-ink shadow-sm" : "text-subtle hover:text-ink")}>DATABASE</button>
                  <button type="button" onClick={() => setIsManualMode(true)} className={cn("px-4 py-1.5 text-[11px] font-bold rounded-md transition-all", isManualMode ? "bg-white text-ink shadow-sm" : "text-subtle hover:text-ink")}>MANUAL ENTRY</button>
                </div>
              </div>
              
              {!isManualMode ? (
                <div className="relative z-[130] space-y-3">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      autoFocus
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Search database..."
                      className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 transition-all"
                    />
                  </div>
                  
                  {!search && (
                    <button 
                      type="button" 
                      onClick={() => setIsManualMode(true)}
                      className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 font-bold text-sm hover:border-accent hover:text-accent transition-all flex items-center justify-center gap-2"
                    >
                      <Plus size={18} />
                      + Manual Quick Add
                    </button>
                  )}

                  {search && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-[0_15px_60px_-15px_rgba(0,0,0,0.3)] border border-gray-100 z-[140] max-h-[300px] overflow-y-auto">
                      {filteredFoods.map(food => (
                        <button
                          type="button"
                          key={food.id}
                          onClick={() => addItem(food)}
                          className="w-full px-4 py-3 text-left hover:bg-green-50 focus:bg-green-50 flex justify-between items-center transition-all active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm text-ink">
                              {food.name_hu}
                              {food.brand && <span className="text-[11px] text-gray-400 font-normal ml-1">({food.brand})</span>}
                              {food.gi != null && <span className={cn("ml-2 font-bold", food.gi < 56 ? "text-green-600" : food.gi < 70 ? "text-yellow-600" : "text-red-500")}>(GI: {food.gi})</span>}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1 text-xs font-semibold text-gray-400">
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-ink">{Math.round(food.calories)} kcal • {Math.round(food.protein)}P {Math.round(food.carbs)}C {Math.round(food.fat)}F <span className="font-normal opacity-70">/ 100g</span></span>
                            <div className="flex gap-2">
                              <span className="bg-gray-50 px-2 py-0.5 rounded">{food.total_fiber}g fiber <span className="font-normal opacity-70">/ 100g</span></span>
                              <span className="bg-gray-50 px-2 py-0.5 rounded">{Math.round(food.sugar ?? 0)}g sugar <span className="font-normal opacity-70">/ 100g</span></span>
                              <span className="bg-gray-50 px-2 py-0.5 rounded">{Math.round(food.saturated_fat ?? 0)}g sat fat <span className="font-normal opacity-70">/ 100g</span></span>
                              {food.gi != null && food.carbs != null && (
                                <span className="bg-accent/5 text-accent px-2 py-0.5 rounded">GL: {Math.round((food.gi * food.carbs * 100) / 10000)} <span className="font-normal opacity-70">/ 100g</span></span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                      {filteredFoods.length === 0 && (
                        <div className="px-5 py-6 text-center text-gray-400 text-sm italic w-full">
                           <div className="inline-block p-3 outline-1 outline-dashed outline-gray-200 rounded-full mb-3 opacity-50"><Search size={20} /></div>
                           <p>No matching foods found</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded-2xl border border-border space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-ink uppercase tracking-tight">Manual Quick Add</h3>
                    <div className="flex bg-white p-0.5 rounded-lg border border-gray-200">
                      <button type="button" onClick={() => setManualForm({...manualForm, isTotal: true})} className={cn("px-2 py-1 text-[9px] font-bold rounded-md transition-all", manualForm.isTotal ? "bg-accent text-white shadow-sm" : "text-subtle")}>TOTAL VALUES</button>
                      <button type="button" onClick={() => setManualForm({...manualForm, isTotal: false})} className={cn("px-2 py-1 text-[9px] font-bold rounded-md transition-all", !manualForm.isTotal ? "bg-accent text-white shadow-sm" : "text-subtle")}>PER 100G</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Food Name</label>
                      <input type="text" value={manualForm.name} onChange={e => setManualForm({...manualForm, name: e.target.value})} placeholder="e.g. Pizza slice" className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Grams</label>
                      <input type="number" value={manualForm.grams} onChange={e => setManualForm({...manualForm, grams: e.target.value})} placeholder="100" className="w-full px-3 py-2.5 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Kcal</label>
                      <input type="number" value={manualForm.calories} onChange={e => setManualForm({...manualForm, calories: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Prot</label>
                      <input type="number" value={manualForm.protein} onChange={e => setManualForm({...manualForm, protein: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Carb</label>
                      <input type="number" value={manualForm.carbs} onChange={e => setManualForm({...manualForm, carbs: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fat</label>
                      <input type="number" value={manualForm.fat} onChange={e => setManualForm({...manualForm, fat: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sugar</label>
                      <input type="number" value={manualForm.sugar} onChange={e => setManualForm({...manualForm, sugar: e.target.value})} placeholder="optional" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sat Fat</label>
                      <input type="number" value={manualForm.saturatedFat} onChange={e => setManualForm({...manualForm, saturatedFat: e.target.value})} placeholder="optional" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Fiber</label>
                      <input type="number" value={manualForm.totalFiber} onChange={e => setManualForm({...manualForm, totalFiber: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Soluble</label>
                      <input type="number" value={manualForm.solubleFiber} onChange={e => setManualForm({...manualForm, solubleFiber: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Insoluble</label>
                      <input type="number" value={manualForm.insolubleFiber} onChange={e => setManualForm({...manualForm, insolubleFiber: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">GI</label>
                      <input type="number" value={manualForm.gi} onChange={e => setManualForm({...manualForm, gi: e.target.value})} placeholder="0" className="w-full px-3 py-2 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-accent transition-all text-sm" />
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setIsManualMode(false)} className="flex-1 py-2.5 bg-white border border-gray-200 text-subtle rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-gray-50 transition-all">Cancel</button>
                    <button type="button" onClick={handleAddManual} className="flex-[2] py-2.5 bg-accent text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95 shadow-sm">Add Item</button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {items.map((item, i) => {
                const food = item.is_custom ? {
                  name_hu: item.name,
                  calories: item.calories,
                  protein: item.protein,
                  carbs: item.carbs,
                  fat: item.fat,
                  sugar: item.sugar,
                  saturated_fat: item.saturated_fat,
                  total_fiber: item.total_fiber ?? item.fiber ?? 0,
                  soluble_fiber: item.soluble_fiber ?? 0,
                  insoluble_fiber: item.insoluble_fiber ?? 0,
                  gi: item.gi,
                } as any as Food : getFoodOrUnknown(foods, item.foodId);
                return (
                  <div key={i} className="flex items-center gap-3 bg-gray-50/80 p-3 rounded-xl border border-transparent hover:border-gray-200 hover:shadow-sm hover:bg-white transition-all group">
                    <div>
                      <div className={cn("font-medium text-sm text-ink", food.isDeleted && 'text-red-500 italic')}>
                        {food.name_hu}
                        {food.brand && <span className="text-[11px] text-gray-400 font-normal ml-1">({food.brand})</span>}
                        {food.name_en && <span className="text-xs text-gray-500 ml-1 font-normal">({food.name_en})</span>}
                        {food.gi != null && <span className={cn("ml-2 font-bold", food.gi < 56 ? "text-green-600" : food.gi < 70 ? "text-yellow-600" : "text-red-500")}>(GI: {food.gi})</span>}
                      </div>
                      <div className="text-xs text-gray-400 font-medium mt-0.5">
                        {Math.round((food.calories * (Number(item.quantityGrams) || 0)) / 100)} kcal • {Math.round((food.protein * (Number(item.quantityGrams) || 0)) / 100)}P {Math.round((food.carbs * (Number(item.quantityGrams) || 0)) / 100)}C {Math.round((food.fat * (Number(item.quantityGrams) || 0)) / 100)}F • {Math.round((food.sugar ?? 0) * (Number(item.quantityGrams) || 0) / 100)}g sugar • {Math.round((food.saturated_fat ?? 0) * (Number(item.quantityGrams) || 0) / 100)}g sat fat
                      </div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                        <span className="text-green-600">{(food.total_fiber * Number(item.quantityGrams) / 100).toFixed(1)}g</span> Fiber
                        {food.gi != null && (
                          <span className="ml-2 text-accent">GL: {Math.round((food.gi * food.carbs * Number(item.quantityGrams)) / 10000)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative group-hover:scale-105 transition-transform">
                        <input
                          type="number"
                          ref={(el) => { quantityRefs.current[i] = el; }}
                          value={item.quantityGrams}
                          onFocus={(e) => { e.target.value = ''; updateQuantity(i, ''); }}
                          onClick={(e) => { e.target.value = ''; updateQuantity(i, ''); }}
                          onChange={e => updateQuantity(i, e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-20 px-2 pl-4 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-left focus:ring-2 focus:border-green-500 focus:outline-none transition-all shadow-inner"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">g</span>
                      </div>
                      <button type="button" onClick={() => removeItem(i)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all active:scale-90"><X size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-4 sticky bottom-0 z-[110]">
          {errorMsg && (
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-100 flex items-center justify-between">
              <span>{errorMsg}</span>
              <button type="button" onClick={() => setErrorMsg(null)} className="p-1 hover:bg-red-100 rounded-full text-red-400 hover:text-red-600 transition-colors">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="flex justify-between items-center">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{mealTotals.total_fiber.toFixed(1)}g</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Fiber</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {hasKnownFiberSplitSummary ? `${mealTotals.soluble_fiber.toFixed(1)}g` : '—'}
                </div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Soluble</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-amber-600">
                  {hasKnownFiberSplitSummary ? `${mealTotals.insoluble_fiber.toFixed(1)}g` : '—'}
                </div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Insoluble</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-accent">{Math.round(mealTotals.gl)}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">GL</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-pink-600">{mealTotals.sugar.toFixed(1)}g</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sugar</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-slate-600">{mealTotals.saturated_fat.toFixed(1)}g</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sat Fat</div>
              </div>
              <div className="h-8 w-px bg-gray-200 mx-1" />
              <div className="text-[11px] text-subtle leading-tight">
                <div className="font-bold text-ink">{Math.round(mealTotals.calories)} kcal</div>
                <div>{Math.round(mealTotals.protein)}P {Math.round(mealTotals.carbs)}C {Math.round(mealTotals.fat)}F</div>
              </div>
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="px-8 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg shadow-green-200 hover:bg-green-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="animate-spin" size={20} /> : 'Save Meal'}
            </button>
          </div>
        </div>
        </form>
      </motion.div>
    </div>
  );
}

interface FoodDatabaseProps {
  foods: Food[];
  setFoods: (foods: Food[]) => void;
  sheetUrl: string;
  setSheetUrl: (url: string) => void;
  isLoading: boolean;
}

function FoodDatabase({ foods, setFoods, sheetUrl, setSheetUrl, isLoading }: FoodDatabaseProps) {
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newFood, setNewFood] = useState<Omit<Food, 'id' | 'source'>>({
    name_hu: '', name_en: '', brand: '', calories: 0, carbs: 0, protein: 0, fat: 0, sugar: 0, saturated_fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0, gi: undefined
  });

  const filteredFoods = foods.filter(f => {
    const query = search.toLowerCase();
    return (f.name_hu || '').toLowerCase().includes(query) || 
           (f.brand && f.brand.toLowerCase().includes(query));
  });

  const handleAddFood = () => {
    const food: Food = {
      ...newFood as Food,
      id: `local-${Date.now()}`,
      source: 'local'
    };
    const updated = [...foods, food];
    setFoods(updated);

    // Save local foods
    const local = updated.filter(f => f.source === 'local');
    localStorage.setItem('fiber_track_local_foods', JSON.stringify(local));

    setIsAdding(false);
    setNewFood({ name_hu: '', name_en: '', brand: '', calories: 0, carbs: 0, protein: 0, fat: 0, sugar: 0, saturated_fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0, gi: undefined });
  };

  const handleDeleteFood = (id: string) => {
    const updated = foods.filter(f => f.id !== id);
    setFoods(updated);
    const local = updated.filter(f => f.source === 'local');
    localStorage.setItem('fiber_track_local_foods', JSON.stringify(local));
  };

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold mb-4">Google Sheets Sync</h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sheet CSV URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
                className="flex-1 px-4 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 transition-all text-sm"
              />
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-3 bg-gray-100 rounded-xl font-bold text-sm hover:bg-gray-200"
              >
                Sync
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              To get this URL: File &gt; Share &gt; Publish to web &gt; Select Sheet &gt; CSV &gt; Publish.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Food Database</h2>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700"
          >
            <Plus size={16} /> Add Food
          </button>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search foods..."
            className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 transition-all"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-50">
                <th className="text-left pb-3">Name</th>
                <th className="text-right pb-3">Fiber</th>
                <th className="text-right pb-3">Kcal</th>
                <th className="text-right pb-3">Source</th>
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">Loading foods...</td></tr>
              ) : filteredFoods.map(food => (
                <tr key={food.id} className="border-b transition-colors hover:bg-gray-50/50 group">
                  <td className="py-4 font-medium">
                    {food.name_hu}
                    {food.brand && <span className="text-[11px] text-gray-400 font-normal ml-1">({food.brand})</span>}
                    {food.gi != null && <span className={cn("ml-2 font-bold", food.gi < 56 ? "text-green-600" : food.gi < 70 ? "text-yellow-600" : "text-red-500")}>(GI: {food.gi})</span>}
                    {food.name_en && <span className="block text-xs text-gray-500 mt-1 font-normal opacity-70">({food.name_en})</span>}
                  </td>
                  <td className="py-4 text-right font-bold text-green-600">{food.total_fiber}g</td>
                  <td className="py-4 text-right text-gray-500">{food.calories}</td>
                  <td className="py-4 text-right">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter",
                      food.source === 'sheets' ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600"
                    )}>
                      {food.source}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    {food.source === 'local' && (
                      <button onClick={() => handleDeleteFood(food.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAdding(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 space-y-6">
              <h3 className="text-xl font-bold">Add Local Food</h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Name</label>
                  <input type="text" placeholder="Név (HU)" value={newFood.name_hu} onChange={e => setNewFood({ ...newFood, name_hu: e.target.value })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 mb-2" />
                  <input type="text" placeholder="Name (EN) - Opcionális" value={newFood.name_en} onChange={e => setNewFood({ ...newFood, name_en: e.target.value })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 mb-2" />
                  <input type="text" placeholder="Brand / Gyártó - Opcionális" value={newFood.brand} onChange={e => setNewFood({ ...newFood, brand: e.target.value })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Calories</label>
                    <input type="number" value={newFood.calories} onChange={e => setNewFood({ ...newFood, calories: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Fiber</label>
                    <input type="number" value={newFood.total_fiber} onChange={e => setNewFood({ ...newFood, total_fiber: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Soluble Fiber</label>
                    <input type="number" value={newFood.soluble_fiber} onChange={e => setNewFood({ ...newFood, soluble_fiber: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Insoluble Fiber</label>
                    <input type="number" value={newFood.insoluble_fiber} onChange={e => setNewFood({ ...newFood, insoluble_fiber: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Carbs</label>
                    <input type="number" value={newFood.carbs} onChange={e => setNewFood({ ...newFood, carbs: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Protein</label>
                    <input type="number" value={newFood.protein} onChange={e => setNewFood({ ...newFood, protein: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fat</label>
                    <input type="number" value={newFood.fat} onChange={e => setNewFood({ ...newFood, fat: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sugar</label>
                    <input type="number" value={newFood.sugar} onChange={e => setNewFood({ ...newFood, sugar: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Saturated Fat</label>
                    <input type="number" value={newFood.saturated_fat} onChange={e => setNewFood({ ...newFood, saturated_fat: Number(e.target.value) })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Glycemic Index (Optional)</label>
                  <input type="number" placeholder="e.g. 55" value={newFood.gi === undefined ? '' : newFood.gi} onChange={e => setNewFood({ ...newFood, gi: e.target.value ? Number(e.target.value) : undefined })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={() => setIsAdding(false)} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold">Cancel</button>
                <button onClick={handleAddFood} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold">Add Food</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

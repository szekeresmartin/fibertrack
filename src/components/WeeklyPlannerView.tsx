import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Search, X, Trash2, 
  Target, Activity, TrendingUp, ShoppingCart,
  AlertCircle, Calendar, ChevronLeft, ChevronRight,
  Loader2, Save, CloudCheck, CheckCircle2,
  Leaf, FileText
} from 'lucide-react';
import { Food, PlannedItem } from '../types';
import { cn, calculateMealTotals, getFoodOrUnknown } from '../lib/utils';
import { format, startOfWeek, addWeeks, subWeeks, endOfWeek } from 'date-fns';
import { generateWeeklyPlanText } from '../lib/exportUtils';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';

interface WeeklyPlannerViewProps {
  foods: Food[];
  user: User;
}

interface MacroTargets {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  fiber: number;
  vegetables: number;
}

export default function WeeklyPlannerView({ foods, user }: WeeklyPlannerViewProps) {
  // --- Week Selection State ---
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  
  // --- Core State ---
  const [targets, setTargets] = useState<MacroTargets>({ 
    protein: 0, carbs: 0, fat: 0, calories: 0, fiber: 0, vegetables: 0 
  });
  const [items, setItems] = useState<PlannedItem[]>([]);
  const [weeklyMeals, setWeeklyMeals] = useState<any[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  
  // --- UI State ---
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [revealedIndex, setRevealedIndex] = useState(-1);
  const [isCopying, setIsCopying] = useState(false);

  const weekStartStr = format(currentWeekStart, 'yyyy-MM-dd');
  const nextWeekStart = addWeeks(currentWeekStart, 1);
  const nextWeekStartStr = format(nextWeekStart, 'yyyy-MM-dd');
  const weekEndStr = format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), 'MMM d');

  // --- Data Loading ---
  const loadPlan = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Plan
      const { data: planData, error: planError } = await supabase
        .from('weekly_plans')
        .select(`
          *,
          weekly_plan_items (
            id,
            food_id,
            grams
          )
        `)
        .eq('user_id', user.id)
        .eq('week_start', weekStartStr)
        .single();

      if (planError && planError.code !== 'PGRST116') throw planError;

      if (planData) {
        setPlanId(planData.id);
        setTargets({
          protein: planData.target_protein || 0,
          carbs: planData.target_carbs || 0,
          fat: planData.target_fat || 0,
          calories: planData.target_calories || 0,
          fiber: planData.target_fiber || 0,
          vegetables: planData.target_vegetables || 0
        });
        setItems((planData.weekly_plan_items || []).map((item: any) => ({
          id: item.id,
          foodId: item.food_id,
          quantityGrams: item.grams
        })));
      } else {
        setPlanId(null);
        setTargets({ protein: 700, carbs: 1400, fat: 500, calories: 15000, fiber: 250, vegetables: 35 });
        setItems([]);
      }

      // 2. Fetch Actual Meals for the Week
      const { data: mealData, error: mealError } = await supabase
        .from('meals')
        .select(`
          *,
          meal_items (
            grams,
            food_id
          )
        `)
        .eq('user_id', user.id)
        .gte('created_at', weekStartStr)
        .lt('created_at', nextWeekStartStr);

      if (mealError) throw mealError;
      setWeeklyMeals(mealData || []);

    } catch (err) {
      console.error('Error loading weekly data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user.id, weekStartStr, nextWeekStartStr]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // --- Save Logic ---
  const savePlan = useCallback(async () => {
    if (isLoading) return;
    setIsSaving(true);
    try {
      let currentPlanId = planId;

      const planPayload = {
        user_id: user.id,
        week_start: weekStartStr,
        target_protein: targets.protein,
        target_carbs: targets.carbs,
        target_fat: targets.fat,
        target_calories: targets.calories,
        target_fiber: targets.fiber,
        target_vegetables: targets.vegetables
      };

      if (currentPlanId) {
        const { error } = await supabase
          .from('weekly_plans')
          .update(planPayload)
          .eq('id', currentPlanId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('weekly_plans')
          .insert(planPayload)
          .select()
          .single();
        if (error) throw error;
        currentPlanId = data.id;
        setPlanId(data.id);
      }

      const { error: deleteError } = await supabase
        .from('weekly_plan_items')
        .delete()
        .eq('plan_id', currentPlanId);
      if (deleteError) throw deleteError;

      if (items.length > 0) {
        const itemsPayload = items.map(item => ({
          plan_id: currentPlanId,
          food_id: item.foodId,
          grams: item.quantityGrams
        }));
        const { error: insertError } = await supabase
          .from('weekly_plan_items')
          .insert(itemsPayload);
        if (insertError) throw insertError;
      }

      setLastSaved(new Date());
    } catch (err) {
      console.error('Error saving plan:', err);
    } finally {
      setIsSaving(false);
    }
  }, [planId, user.id, weekStartStr, targets, items, isLoading]);

  useEffect(() => {
    if (isLoading) return;
    const timer = setTimeout(() => savePlan(), 1500);
    return () => clearTimeout(timer);
  }, [targets, items, savePlan, isLoading]);

  // --- Staggered Reveal ---
  useEffect(() => {
    setRevealedIndex(-1);
    const sequence = [0, 1, 2];
    sequence.forEach((val, i) => {
      setTimeout(() => setRevealedIndex(val), i * 100);
    });
  }, [currentWeekStart]);

  // --- Calculations ---
  const plannedTotals = useMemo(() => {
    const mealItems = items.map(item => ({
      food: getFoodOrUnknown(foods, item.foodId),
      quantity: item.quantityGrams
    }));
    const totals = calculateMealTotals(mealItems);
    
    // Calculate Vegetable Count (Planned)
    const vegCount = items.filter(item => {
      const food = getFoodOrUnknown(foods, item.foodId);
      return food.category === 'vegetable';
    }).length;

    return { ...totals, vegetable_count: vegCount };
  }, [items, foods]);

  const actualTotals = useMemo(() => {
    const allMealItems = weeklyMeals.flatMap(m => (m.meal_items || []).map((mi: any) => ({
      food: getFoodOrUnknown(foods, mi.food_id),
      quantity: mi.grams
    })));
    const totals = calculateMealTotals(allMealItems);

    // Calculate Vegetable Count (Actual) - Count distinct vegetable occurrences in meals
    const vegCount = weeklyMeals.reduce((count, m) => {
      const mealVegItems = (m.meal_items || []).filter((mi: any) => {
        const food = getFoodOrUnknown(foods, mi.food_id);
        return food.category === 'vegetable';
      });
      return count + mealVegItems.length;
    }, 0);

    return { ...totals, vegetable_count: vegCount };
  }, [weeklyMeals, foods]);

  const actualGramsPerFood = useMemo(() => {
    const map: Record<string, number> = {};
    weeklyMeals.forEach(m => {
      (m.meal_items || []).forEach((mi: any) => {
        if (mi.food_id) {
          map[mi.food_id] = (map[mi.food_id] || 0) + (mi.grams || 0);
        }
      });
    });
    return map;
  }, [weeklyMeals]);

  // --- Handlers ---
  const nextWeek = () => setCurrentWeekStart(prev => addWeeks(prev, 1));
  const prevWeek = () => setCurrentWeekStart(prev => subWeeks(prev, 1));

  const addItem = (food: Food) => {
    const newItem: PlannedItem = {
      id: crypto.randomUUID(),
      foodId: food.id,
      quantityGrams: 100
    };
    setItems(prev => [...prev, newItem]);
    setSearch('');
    setIsAddModalOpen(false);
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(item => item.id !== id));
  const updateQuantity = (id: string, grams: number) => setItems(prev => prev.map(item => item.id === id ? { ...item, quantityGrams: grams } : item));
  const updateTarget = (key: keyof MacroTargets, val: string) => {
    const num = parseFloat(val) || 0;
    setTargets(prev => ({ ...prev, [key]: num }));
  };

  const filteredFoods = foods
    .filter(f => {
      const query = search.toLowerCase();
      return (f.name_hu || '').toLowerCase().includes(query) || 
             (f.brand && f.brand.toLowerCase().includes(query));
    })
    .slice(0, 10);

  const handleExportPlan = async () => {
    const weekRange = `${format(currentWeekStart, 'MMM d')} – ${weekEndStr}`;
    const planItems = items.map(item => {
      const food = getFoodOrUnknown(foods, item.foodId);
      return {
        name: food.name_hu || 'Unknown',
        grams: item.quantityGrams
      };
    });

    const text = generateWeeklyPlanText(weekRange, planItems, plannedTotals);
    
    try {
      await navigator.clipboard.writeText(text);
      setIsCopying(true);
      setTimeout(() => setIsCopying(false), 2000);
    } catch (err) {
      console.error('Failed to copy plan:', err);
    }
  };

  if (isLoading && !planId) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Loader2 className="animate-spin text-accent mb-4" size={48} />
        <p className="text-subtle font-medium">Loading your weekly plan...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-32 max-w-5xl mx-auto w-full px-4 sm:px-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white p-8 rounded-[2.5rem] border border-border shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-[900] tracking-tight text-ink">Macro Planner</h2>
          <div className="flex items-center gap-2 text-subtle text-sm">
            {isSaving ? (
              <span className="flex items-center gap-1 text-accent animate-pulse">
                <Loader2 size={12} className="animate-spin" /> saving...
              </span>
            ) : lastSaved ? (
              <span className="flex items-center gap-1 text-accent/60">
                <CloudCheck size={12} /> saved {format(lastSaved, 'HH:mm')}
              </span>
            ) : (
              <span>Plan your nutritional strategy</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 bg-gray-50 p-2 rounded-2xl">
          <button onClick={prevWeek} className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-subtle active:scale-90">
            <ChevronLeft size={20} />
          </button>
          <div className="px-4 text-center min-w-[160px]">
             <div className="text-[10px] font-black uppercase tracking-widest text-subtle mb-0.5">Week of</div>
             <div className="text-sm font-black text-ink">{format(currentWeekStart, 'MMM d')} – {weekEndStr}</div>
          </div>
          <button onClick={nextWeek} className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-subtle active:scale-90">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8">
        {/* Sidebar: Targets & Progress */}
        <aside className="space-y-6">
          <div className={cn("bg-white p-8 rounded-[2.5rem] border border-border shadow-sm transition-all duration-500", revealedIndex < 0 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-ink text-white rounded-2xl flex items-center justify-center">
                <Target size={20} />
              </div>
              <h3 className="text-xl font-black text-ink tracking-tight">Weekly Targets</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <TargetInput label="Protein (g)" value={targets.protein} onChange={(v) => updateTarget('protein', v)} bg="bg-blue-50" />
                <TargetInput label="Carbs (g)" value={targets.carbs} onChange={(v) => updateTarget('carbs', v)} bg="bg-purple-50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <TargetInput label="Fat (g)" value={targets.fat} onChange={(v) => updateTarget('fat', v)} bg="bg-pink-50" />
                <TargetInput label="Fiber (g)" value={targets.fiber} onChange={(v) => updateTarget('fiber', v)} bg="bg-green-50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <TargetInput label="Kcal" value={targets.calories} onChange={(v) => updateTarget('calories', v)} bg="bg-orange-50" />
                <TargetInput label="Veg (count)" value={targets.vegetables} onChange={(v) => updateTarget('vegetables', v)} bg="bg-emerald-50" />
              </div>
            </div>
          </div>

          <div className={cn("bg-ink text-white p-8 rounded-[2.5rem] shadow-xl transition-all duration-500", revealedIndex < 1 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
            <h3 className="text-lg font-black tracking-tight mb-6 flex items-center gap-2">
              <Activity size={18} className="text-accent" />
              Planner Status
            </h3>
            <div className="space-y-5">
              <MacroProgress label="Calories" current={plannedTotals.calories} target={targets.calories} unit="kcal" color="bg-accent" />
              <MacroProgress label="Protein" current={plannedTotals.protein} target={targets.protein} unit="g" color="bg-blue-400" />
              <MacroProgress label="Carbohydrates" current={plannedTotals.carbs} target={targets.carbs} unit="g" color="bg-purple-400" />
              <MacroProgress label="Fat" current={plannedTotals.fat} target={targets.fat} unit="g" color="bg-pink-400" />
              <MacroProgress label="Fiber" current={plannedTotals.total_fiber} target={targets.fiber} unit="g" color="bg-green-400" />
              <MacroProgress label="Vegetables" current={plannedTotals.vegetable_count} target={targets.vegetables} unit="x" color="bg-emerald-400" />
            </div>
          </div>

          <div className={cn("bg-white p-8 rounded-[2.5rem] border border-border shadow-sm transition-all duration-500", revealedIndex < 1 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
            <h3 className="text-lg font-black tracking-tight mb-6 flex items-center gap-2 text-ink">
              <CheckCircle2 size={18} className="text-accent" />
              Weekly Progress
            </h3>
            <div className="space-y-6">
              <MacroProgress label="Calories" current={actualTotals.calories} target={targets.calories} unit="kcal" color="bg-accent" isActual />
              <MacroProgress label="Protein" current={actualTotals.protein} target={targets.protein} unit="g" color="bg-blue-500" isActual />
              <MacroProgress label="Carbohydrates" current={actualTotals.carbs} target={targets.carbs} unit="g" color="bg-purple-500" isActual />
              <MacroProgress label="Fat" current={actualTotals.fat} target={targets.fat} unit="g" color="bg-pink-500" isActual />
              <MacroProgress label="Fiber" current={actualTotals.total_fiber} target={targets.fiber} unit="g" color="bg-green-500" isActual />
              <MacroProgress label="Vegetables" current={actualTotals.vegetable_count} target={targets.vegetables} unit="x" color="bg-emerald-500" isActual />
            </div>
          </div>
        </aside>

        {/* Main: Planned Items */}
        <div className={cn("space-y-6 transition-all duration-500", revealedIndex < 2 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
          <div className="flex justify-between items-center bg-white p-4 px-8 rounded-[2rem] border border-border shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-subtle">
                <ShoppingCart size={20} />
              </div>
              <span className="font-black text-ink">Planned Foods</span>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={handleExportPlan}
                className={cn(
                  "flex items-center gap-2 px-3 sm:px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 border",
                  isCopying 
                    ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                    : "bg-white text-subtle border-border hover:bg-gray-50 shadow-sm"
                )}
                title="Export Plan"
              >
                {isCopying ? (
                  <>
                    <CheckCircle2 size={16} /> <span className="hidden sm:inline">Copied</span>
                  </>
                ) : (
                  <>
                    <FileText size={16} /> <span className="hidden sm:inline">Export Plan</span>
                  </>
                )}
              </button>
              <button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-2 px-6 py-2.5 bg-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95 shadow-lg shadow-accent/20">
                <Plus size={16} /> Add Food
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[2.5rem] border-2 border-dashed border-gray-100">
                  <TrendingUp size={32} className="text-subtle/30 mb-4" />
                  <h4 className="text-lg font-bold text-ink">No items in this week's plan</h4>
                </div>
              ) : (
                items.map((item) => {
                  const food = getFoodOrUnknown(foods, item.foodId);
                  const actualGrams = actualGramsPerFood[item.foodId] || 0;
                  return (
                    <PlannedItemCard 
                      key={item.id}
                      item={item}
                      food={food}
                      actualGrams={actualGrams}
                      onRemove={() => removeItem(item.id)}
                      onUpdateQuantity={(v) => updateQuantity(item.id, v)}
                    />
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddModalOpen(false)} className="absolute inset-0 bg-ink/60 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="relative w-full max-w-lg bg-white rounded-[32px] shadow-2xl overflow-hidden">
              <div className="p-8 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-2xl font-black tracking-tight text-ink">Add to Plan</h3>
                <button onClick={() => setIsAddModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
              </div>
              <div className="p-8 space-y-6">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle" size={20} />
                  <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search food database..." className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-ink font-medium" />
                </div>
                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                  {filteredFoods.map(food => (
                    <button key={food.id} onClick={() => addItem(food)} className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100 active:scale-[0.98] group">
                      <div className="text-left">
                        <div className="font-black text-ink">{food.name_hu} {food.category === 'vegetable' && <Leaf size={14} className="inline text-emerald-500 ml-1" />}</div>
                        <div className="text-xs font-bold text-subtle uppercase tracking-wider mt-1">{Math.round(food.calories)} kcal • {Math.round(food.protein)}P {Math.round(food.carbs)}C {Math.round(food.fat)}F</div>
                      </div>
                      <Plus size={20} className="text-subtle group-hover:text-accent group-hover:rotate-90 transition-all" />
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TargetInput({ label, value, onChange, bg }: { label: string, value: number, onChange: (v: string) => void, bg: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black text-subtle uppercase tracking-widest ml-1">{label}</label>
      <div className={cn("relative rounded-2xl p-0.5", bg)}>
        <input type="number" value={value} onChange={e => onChange(e.target.value)} className="w-full bg-white border-none rounded-[14px] px-3 py-2.5 text-sm font-black text-ink focus:ring-0" />
      </div>
    </div>
  );
}

function MacroProgress({ label, current, target, color, unit = 'g', isActual = false }: { label: string, current: number, target: number, color: string, unit?: string, isActual?: boolean }) {
  const percentage = Math.min((current / (target || 1)) * 100, 100);
  const isOver = current > target;
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <span className={cn("text-xs font-bold uppercase tracking-widest", isActual ? "text-subtle" : "text-white/60")}>{label}</span>
        <span className={cn("text-sm font-black", isActual ? "text-ink" : "text-white")}>
          {Math.round(current).toLocaleString()}<span className={cn("text-xs ml-1 opacity-40")}>/ {Math.round(target).toLocaleString()}{unit}</span>
        </span>
      </div>
      <div className={cn("h-2 w-full rounded-full overflow-hidden", isActual ? "bg-gray-100" : "bg-white/10")}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${percentage}%` }} className={cn("h-full transition-all duration-1000", isOver ? "bg-red-400" : color)} />
      </div>
    </div>
  );
}

function PlannedItemCard({ item, food, actualGrams, onRemove, onUpdateQuantity }: { key?: string | number, item: PlannedItem, food: Food, actualGrams: number, onRemove: () => void, onUpdateQuantity: (v: number) => void }) {
  const factor = item.quantityGrams / 100;
  const adherencePercent = Math.min((actualGrams / (item.quantityGrams || 1)) * 100, 100);
  const isVeg = food.category === 'vegetable';
  return (
    <motion.div layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white p-5 rounded-[2rem] border border-border shadow-sm group hover:border-accent/20 transition-all overflow-hidden relative">
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-50">
        <motion.div initial={{ width: 0 }} animate={{ width: `${adherencePercent}%` }} className="h-full bg-accent/40" />
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs border transition-all", isVeg ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-gray-50 text-subtle border-gray-100")}>
            {isVeg ? <Leaf size={20} /> : `${Math.round(food.total_fiber * factor)}g`}
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start">
              <h4 className="font-black text-ink flex items-center gap-1.5">{food.name_hu} {isVeg && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] rounded uppercase tracking-tighter">Veg</span>}</h4>
              <div className="text-[10px] font-black text-subtle/50 uppercase tracking-widest">{Math.round(actualGrams)}g / {item.quantityGrams}g</div>
            </div>
            <div className="flex gap-3 mt-1">
               <MacroTag label="P" val={Math.round(food.protein * factor)} color="bg-blue-50 text-blue-700" />
               <MacroTag label="C" val={Math.round(food.carbs * factor)} color="bg-purple-50 text-purple-700" />
               <MacroTag label="F" val={Math.round(food.fat * factor)} color="bg-pink-50 text-pink-700" />
               <div className="text-[10px] font-bold text-subtle/40 uppercase tracking-widest flex items-center">{Math.round(food.calories * factor)} kcal</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto pt-4 sm:pt-0 border-t sm:border-none border-gray-50">
          <div className="relative flex-1 sm:flex-none">
             <input type="number" value={item.quantityGrams} onChange={e => onUpdateQuantity(parseFloat(e.target.value) || 0)} className="w-full sm:w-24 pl-4 pr-8 py-2.5 bg-gray-50 border-none rounded-xl text-sm font-black focus:ring-2 focus:ring-accent transition-all" />
             <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-subtle uppercase">g</span>
          </div>
          <button onClick={onRemove} className="p-2.5 text-subtle/30 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-90"><Trash2 size={18} /></button>
        </div>
      </div>
    </motion.div>
  );
}

function MacroTag({ label, val, color }: { label: string, val: number, color: string }) {
  return (
    <div className={cn("px-2 py-0.5 rounded-lg flex items-center gap-1", color)}>
      <span className="text-[9px] font-black opacity-50">{label}</span>
      <span className="text-[11px] font-black">{val}</span>
    </div>
  );
}

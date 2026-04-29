import React, { useState, useEffect, useMemo } from 'react';
import { Plus, X, Search, ChevronLeft, ChevronRight, Save, Trash2, Calendar, Settings, Copy } from 'lucide-react';
import { Food } from '../types';
import { User } from '@supabase/supabase-js';
import { cn, getFoodOrUnknown } from '../lib/utils';
import { format, startOfWeek, addDays, subWeeks, addWeeks } from 'date-fns';

export type DayType = 'rest' | 'gym' | 'match';

export interface DayTypeTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface GridMealItem {
  id: string; // local id for keys
  foodId: string | null;
  quantityGrams: number;
  is_custom?: boolean;
  name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export interface GridMeal {
  id: string;
  items: GridMealItem[];
}

export interface GridDay {
  date: string; // YYYY-MM-DD
  type: DayType;
  meals: GridMeal[]; // 5 or 6 depending on type
}

export interface GridWeek {
  weekStart: string; // YYYY-MM-DD of Monday
  days: GridDay[]; // Always 7 days
}

interface WeeklyMealPlannerViewProps {
  foods: Food[];
  user: User;
}

const DEFAULT_TARGETS: Record<DayType, DayTypeTargets> = {
  rest: { calories: 2000, protein: 150, carbs: 200, fat: 65, fiber: 35 },
  gym: { calories: 2500, protein: 180, carbs: 300, fat: 75, fiber: 35 },
  match: { calories: 2800, protein: 160, carbs: 400, fat: 60, fiber: 35 },
};

export default function WeeklyMealPlannerView({ foods, user }: WeeklyMealPlannerViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Settings for targets
  const [targets, setTargets] = useState<Record<DayType, DayTypeTargets>>(() => {
    const saved = localStorage.getItem('fibertrack_grid_targets');
    return saved ? JSON.parse(saved) : DEFAULT_TARGETS;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Week Plan State
  const weekStartString = format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  
  const [weekPlan, setWeekPlan] = useState<GridWeek>(() => generateEmptyWeek(weekStartString));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [sourceDayIndex, setSourceDayIndex] = useState<number | null>(null);

  // Load from localStorage (runs once on mount)
  useEffect(() => {
    console.log('[WeeklyMealGridView] LOAD: Checking localStorage for "weekly_meal_grid"');
    const saved = localStorage.getItem('weekly_meal_grid');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        console.log('[WeeklyMealGridView] LOAD: Found saved data, setting state', parsed);
        setWeekPlan(parsed);
      } catch (e) {
        console.error('[WeeklyMealGridView] LOAD: Error parsing saved data', e);
      }
    } else {
      console.log('[WeeklyMealGridView] LOAD: No saved data found, keeping empty initialization');
    }
    setHasLoaded(true);
  }, []);

  // Update dates if user navigates to a different week, preserving the meal data
  useEffect(() => {
    if (!hasLoaded) return;
    setWeekPlan(prev => {
      if (prev.weekStart === weekStartString) return prev;
      
      console.log('[WeeklyMealGridView] Week changed, updating dates to match', weekStartString);
      const start = new Date(weekStartString);
      const newDays = prev.days.map((day, i) => ({
        ...day,
        date: format(addDays(start, i), 'yyyy-MM-dd')
      }));
      return { ...prev, weekStart: weekStartString, days: newDays };
    });
  }, [weekStartString, hasLoaded]);

  // Save to localStorage (triggers on state change)
  useEffect(() => {
    if (!hasLoaded) return; // Prevent overwriting with initial empty state before load finishes
    console.log('[WeeklyMealGridView] SAVE: Saving state to localStorage', weekPlan);
    localStorage.setItem('weekly_meal_grid', JSON.stringify(weekPlan));
  }, [weekPlan, hasLoaded]);

  useEffect(() => {
    localStorage.setItem('fibertrack_grid_targets', JSON.stringify(targets));
  }, [targets]);

  function generateEmptyWeek(startStr: string): GridWeek {
    const start = new Date(startStr);
    const days: GridDay[] = Array.from({ length: 7 }).map((_, i) => {
      const d = addDays(start, i);
      const isWeekend = i === 5 || i === 6;
      const defaultType: DayType = isWeekend ? 'rest' : 'gym'; // Arbitrary defaults
      return {
        date: format(d, 'yyyy-MM-dd'),
        type: defaultType,
        meals: Array.from({ length: defaultType === 'rest' ? 5 : 6 }).map((_, mi) => ({
          id: `${format(d, 'yyyy-MM-dd')}-m${mi}`,
          items: []
        }))
      };
    });
    return { weekStart: startStr, days };
  }

  const handlePrevWeek = () => setCurrentDate(prev => subWeeks(prev, 1));
  const handleNextWeek = () => setCurrentDate(prev => addWeeks(prev, 1));

  const updateDayType = (dayIndex: number, newType: DayType) => {
    setWeekPlan(prev => {
      const newDays = [...prev.days];
      const targetMealCount = newType === 'rest' ? 5 : 6;
      let newMeals = [...newDays[dayIndex].meals];
      
      if (newMeals.length > targetMealCount) {
        newMeals = newMeals.slice(0, targetMealCount); // Truncate
      } else while (newMeals.length < targetMealCount) {
        newMeals.push({
          id: `${newDays[dayIndex].date}-m${newMeals.length}`,
          items: []
        });
      }

      newDays[dayIndex] = {
        ...newDays[dayIndex],
        type: newType,
        meals: newMeals
      };
      return { ...prev, days: newDays };
    });
  };

  const addFoodToMeal = (dayIndex: number, mealIndex: number, food: Food) => {
    setWeekPlan(prev => {
      const newDays = [...prev.days];
      const newMeals = [...newDays[dayIndex].meals];
      const newItems = [...newMeals[mealIndex].items];
      
      newItems.push({
        id: `i-${Date.now()}`,
        foodId: food.id,
        quantityGrams: 100
      });
      
      newMeals[mealIndex] = { ...newMeals[mealIndex], items: newItems };
      newDays[dayIndex] = { ...newDays[dayIndex], meals: newMeals };
      return { ...prev, days: newDays };
    });
  };

  const updateItemGrams = (dayIndex: number, mealIndex: number, itemIndex: number, grams: number) => {
    setWeekPlan(prev => {
      const newDays = [...prev.days];
      const newMeals = [...newDays[dayIndex].meals];
      const newItems = [...newMeals[mealIndex].items];
      
      newItems[itemIndex] = { ...newItems[itemIndex], quantityGrams: grams };
      
      newMeals[mealIndex] = { ...newMeals[mealIndex], items: newItems };
      newDays[dayIndex] = { ...newDays[dayIndex], meals: newMeals };
      return { ...prev, days: newDays };
    });
  };

  const removeItem = (dayIndex: number, mealIndex: number, itemIndex: number) => {
    setWeekPlan(prev => {
      const newDays = [...prev.days];
      const newMeals = [...newDays[dayIndex].meals];
      const newItems = [...newMeals[mealIndex].items];
      
      newItems.splice(itemIndex, 1);
      
      newMeals[mealIndex] = { ...newMeals[mealIndex], items: newItems };
      newDays[dayIndex] = { ...newDays[dayIndex], meals: newMeals };
      return { ...prev, days: newDays };
    });
  };

  // State for active mini-search
  const [activeSearchCell, setActiveSearchCell] = useState<{day: number, meal: number} | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredFoods = useMemo(() => {
    if (!searchQuery) return foods.slice(0, 10);
    const q = searchQuery.toLowerCase();
    return foods.filter(f => 
      f.name_hu.toLowerCase().includes(q) || 
      (f.brand && f.brand.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [foods, searchQuery]);

  const calculateDayMacros = (day: GridDay) => {
    let cal = 0, pro = 0, car = 0, fat = 0, fib = 0;
    day.meals.forEach(m => {
      m.items.forEach(item => {
        let factor = item.quantityGrams / 100;
        if (item.is_custom) {
          cal += (item.calories || 0) * factor;
          pro += (item.protein || 0) * factor;
          car += (item.carbs || 0) * factor;
          fat += (item.fat || 0) * factor;
          fib += (item.fiber || 0) * factor;
        } else if (item.foodId) {
          const f = getFoodOrUnknown(foods, item.foodId);
          cal += f.calories * factor;
          pro += f.protein * factor;
          car += f.carbs * factor;
          fat += f.fat * factor;
          fib += f.total_fiber * factor;
        }
      });
    });
    return { cal, pro, car, fat, fib };
  };

  // Render cell
  const renderCell = (day: GridDay, dIndex: number, mIndex: number) => {
    const meal = day.meals[mIndex];
    if (!meal) return <div className="p-2 border border-dashed border-gray-200 bg-gray-50 rounded-xl flex items-center justify-center min-h-[100px] text-gray-300">N/A</div>;

    const isSearching = activeSearchCell?.day === dIndex && activeSearchCell?.meal === mIndex;

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-3 min-h-[120px] flex flex-col gap-2 relative shadow-sm">
        <div className="font-bold text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-1">
          Meal {mIndex + 1}
        </div>
        
        <div className="flex-1 space-y-2">
          {meal.items.map((item, iIndex) => {
            const f = item.is_custom 
              ? { name_hu: item.name, calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat, total_fiber: item.fiber || 0 }
              : getFoodOrUnknown(foods, item.foodId || '');
            
            return (
              <div key={item.id} className="flex flex-col gap-1 bg-gray-50 p-2 rounded-lg relative group">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold leading-tight pr-4">{f.name_hu}</span>
                  <button onClick={() => removeItem(dIndex, mIndex, iIndex)} className="text-gray-300 hover:text-red-500 absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={12} />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={item.quantityGrams || ''}
                    onChange={e => updateItemGrams(dIndex, mIndex, iIndex, Number(e.target.value))}
                    className="w-12 h-6 text-xs px-1 border border-gray-200 rounded"
                    placeholder="g"
                  />
                  <span className="text-[10px] text-gray-400">g</span>
                  <span className="text-[10px] text-gray-400 ml-auto font-medium">
                    {Math.round(((f.calories || 0) * item.quantityGrams) / 100)} kcal
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {isSearching ? (
          <div className="absolute top-full left-0 z-50 w-[250px] bg-white rounded-xl shadow-xl border border-gray-100 mt-2 p-2">
            <div className="flex items-center border-b border-gray-100 pb-2 mb-2">
              <Search size={14} className="text-gray-400 ml-2 mr-2" />
              <input
                type="text"
                autoFocus
                placeholder="Search food..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs outline-none"
              />
              <button onClick={() => { setActiveSearchCell(null); setSearchQuery(''); }}><X size={14} className="text-gray-400" /></button>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {filteredFoods.map(f => (
                <button
                  key={f.id}
                  onClick={() => {
                    addFoodToMeal(dIndex, mIndex, f);
                    setActiveSearchCell(null);
                    setSearchQuery('');
                  }}
                  className="w-full text-left p-2 hover:bg-gray-50 rounded-lg flex flex-col"
                >
                  <span className="text-xs font-medium">{f.name_hu}</span>
                  <span className="text-[10px] text-gray-400">{f.calories} kcal / 100g</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setActiveSearchCell({ day: dIndex, meal: mIndex }); setSearchQuery(''); }}
            className="w-full py-1.5 border border-dashed border-gray-200 text-gray-400 rounded-lg flex justify-center items-center hover:bg-gray-50 hover:text-green-600 transition-colors mt-auto"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    );
  };

  // Weekly Totals
  const weeklyTotals = useMemo(() => {
    let cal = 0, pro = 0, car = 0, fat = 0, targetCal = 0, targetPro = 0, targetCar = 0, targetFat = 0;
    weekPlan.days.forEach(d => {
      const macros = calculateDayMacros(d);
      cal += macros.cal; pro += macros.pro; car += macros.car; fat += macros.fat;
      const t = targets[d.type];
      targetCal += t.calories; targetPro += t.protein; targetCar += t.carbs; targetFat += t.fat;
    });
    return { cal, pro, car, fat, targetCal, targetPro, targetCar, targetFat };
  }, [weekPlan, targets]);

  return (
    <div className="flex flex-col h-full bg-bg font-sans max-w-[1600px] mx-auto w-full">
      {/* Header */}
      <div className="bg-white border-b border-border p-4 px-6 flex justify-between items-center z-20 shadow-sm relative">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center text-accent">
            <Calendar size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black text-ink tracking-tight">Meal Planner Grid</h1>
            <p className="text-sm text-subtle font-medium">Plan meals and hit your macro targets based on training days.</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Weekly Summary */}
          <div className="hidden lg:flex gap-4 items-center">
            <div className="text-right">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">W. Calories</div>
              <div className="text-sm font-bold text-ink">{Math.round(weeklyTotals.cal)} / {weeklyTotals.targetCal}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">W. Protein</div>
              <div className="text-sm font-bold text-ink">{Math.round(weeklyTotals.pro)} / {weeklyTotals.targetPro}</div>
            </div>
          </div>

          <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
            <Settings size={18} className="text-subtle" />
          </button>
          
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button onClick={handlePrevWeek} className="p-2 hover:bg-white rounded-lg transition-colors"><ChevronLeft size={18} /></button>
            <div className="px-4 py-2 font-bold text-sm bg-white rounded-lg shadow-sm border border-gray-100">
              {format(new Date(weekStartString), 'MMM d')} - {format(addDays(new Date(weekStartString), 6), 'MMM d')}
            </div>
            <button onClick={handleNextWeek} className="p-2 hover:bg-white rounded-lg transition-colors"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>

      {/* Grid Area */}
      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-[1200px] grid grid-cols-7 gap-4">
          {/* Day Headers */}
          {weekPlan.days.map((day, dIndex) => {
            const dDate = new Date(day.date);
            const macros = calculateDayMacros(day);
            const target = targets[day.type];

            return (
              <div key={dIndex} className="flex flex-col gap-4">
                {/* Header Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-col items-center relative group">
                  <button
                    onClick={() => setSourceDayIndex(dIndex)}
                    className="absolute top-2 right-2 p-1.5 text-gray-300 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Copy Day"
                  >
                    <Copy size={14} />
                  </button>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{format(dDate, 'EEEE')}</span>
                  <span className="text-xl font-black mb-3">{format(dDate, 'MMM d')}</span>
                  
                  <select
                    value={day.type}
                    onChange={(e) => updateDayType(dIndex, e.target.value as DayType)}
                    className={cn(
                      "w-full text-center text-xs font-bold uppercase tracking-widest py-1.5 rounded-lg border-none focus:ring-0 appearance-none cursor-pointer",
                      day.type === 'rest' ? "bg-blue-50 text-blue-600" :
                      day.type === 'gym' ? "bg-orange-50 text-orange-600" :
                      "bg-purple-50 text-purple-600"
                    )}
                  >
                    <option value="rest">Rest Day</option>
                    <option value="gym">Gym Day</option>
                    <option value="match">Match Day</option>
                  </select>
                </div>

                {/* Meals */}
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 6 }).map((_, mIndex) => (
                    <React.Fragment key={mIndex}>
                      {renderCell(day, dIndex, mIndex)}
                    </React.Fragment>
                  ))}
                </div>

                {/* Day Summary Footer */}
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mt-2 flex flex-col gap-3 sticky bottom-4">
                  <div className="font-bold text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-1 text-center">
                    Day Totals
                  </div>
                  
                  <div className="space-y-2">
                    {/* Calories */}
                    <div>
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1">
                        <span className="text-gray-500">Kcal</span>
                        <span className="text-ink">{Math.round(macros.cal)} <span className="text-gray-400">/ {target.calories}</span></span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", macros.cal > target.calories ? "bg-red-500" : "bg-gray-800")} style={{ width: `${Math.min((macros.cal / target.calories) * 100, 100)}%` }} />
                      </div>
                    </div>
                    {/* Protein */}
                    <div>
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1">
                        <span className="text-gray-500">Protein</span>
                        <span className="text-ink">{Math.round(macros.pro)} <span className="text-gray-400">/ {target.protein}g</span></span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min((macros.pro / target.protein) * 100, 100)}%` }} />
                      </div>
                    </div>
                    {/* Carbs */}
                    <div>
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1">
                        <span className="text-gray-500">Carbs</span>
                        <span className="text-ink">{Math.round(macros.car)} <span className="text-gray-400">/ {target.carbs}g</span></span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.min((macros.car / target.carbs) * 100, 100)}%` }} />
                      </div>
                    </div>
                    {/* Fat */}
                    <div>
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1">
                        <span className="text-gray-500">Fat</span>
                        <span className="text-ink">{Math.round(macros.fat)} <span className="text-gray-400">/ {target.fat}g</span></span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min((macros.fat / target.fat) * 100, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Configure Day Type Targets</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              {(['rest', 'gym', 'match'] as DayType[]).map((type) => (
                <div key={type} className="border border-gray-100 p-4 rounded-2xl bg-gray-50">
                  <h3 className="font-bold uppercase tracking-widest text-sm mb-4 text-ink flex items-center gap-2">
                    {type} DAY TARGETS
                  </h3>
                  <div className="grid grid-cols-5 gap-3">
                    {['calories', 'protein', 'carbs', 'fat', 'fiber'].map((macro) => (
                      <div key={macro}>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">{macro}</label>
                        <input
                          type="number"
                          value={targets[type][macro as keyof DayTypeTargets]}
                          onChange={(e) => setTargets({
                            ...targets,
                            [type]: { ...targets[type], [macro]: Number(e.target.value) }
                          })}
                          className="w-full px-3 py-2 border-none bg-white rounded-xl focus:ring-2 focus:ring-accent text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-3 mt-6 bg-ink text-white font-bold rounded-xl hover:bg-gray-800 transition-colors">
              Save Settings
            </button>
          </div>
        </div>
      )}

      {/* Copy Day Modal */}
      {sourceDayIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSourceDayIndex(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 text-center space-y-6">
            <div className="w-16 h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-2">
               <Copy size={32} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight">Copy Day</h3>
              <p className="text-sm text-subtle mt-1">
                Copying meals from {format(new Date(weekPlan.days[sourceDayIndex].date), 'EEEE, MMM d')}
              </p>
            </div>
            
            <div className="space-y-2 text-left">
               <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Target Day</label>
               <select 
                  className="w-full pl-4 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-sm font-semibold"
                  onChange={(e) => {
                     const targetIndex = Number(e.target.value);
                     if (targetIndex === sourceDayIndex) return;

                     const targetDay = weekPlan.days[targetIndex];
                     const hasMeals = targetDay.meals.some(m => m.items.length > 0);
                     if (hasMeals) {
                        if (!window.confirm("Target day already has meals. Replace existing meals?")) {
                           e.target.value = "";
                           return; 
                        }
                     }

                     setWeekPlan(prev => {
                        const newDays = [...prev.days];
                        const sourceMeals = newDays[sourceDayIndex].meals;
                        
                        const clonedMeals = sourceMeals.map((m, mIdx) => ({
                           id: `${newDays[targetIndex].date}-m${mIdx}`,
                           items: m.items.map(item => ({
                              ...item,
                              id: `i-${Date.now()}-${Math.random().toString(36).substring(2)}`
                           }))
                        }));

                        newDays[targetIndex] = {
                           ...newDays[targetIndex],
                           meals: clonedMeals
                        };
                        return { ...prev, days: newDays };
                     });
                     
                     setSourceDayIndex(null);
                  }}
                  defaultValue=""
               >
                  <option value="" disabled>Select Target Day</option>
                  {weekPlan.days.map((d, i) => (
                    <option key={i} value={i} disabled={i === sourceDayIndex}>
                      {format(new Date(d.date), 'EEEE, MMM d')}
                    </option>
                  ))}
               </select>
            </div>
            
            <button onClick={() => setSourceDayIndex(null)} className="w-full bg-gray-100 text-ink py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-gray-200 transition-all active:scale-[0.98]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

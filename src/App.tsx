/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Settings,
  Database,
  Clock,
  ChevronRight,
  Trash2,
  Search,
  X,
  Save,
  ArrowLeft,
  LogOut,
  Mail,
  Loader2,
  Lock
} from 'lucide-react';
import { Food, Meal, DailyTotals, MealItem } from './types';
import { fetchFoodsFromSheets } from './lib/googleSheets';
import { cn, calculateMealTotals } from './lib/utils';
import { format } from 'date-fns';
import { supabase } from './lib/supabase';
import { User } from '@supabase/supabase-js';

// No mock authentication, fully relying on Supabase state.

const getFoodOrUnknown = (foods: Food[], id: string): Food => {
  return foods.find(f => f.id === id) || {
    id,
    name: 'Unknown / Deleted Food',
    calories: 0, carbs: 0, protein: 0, fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0,
    source: 'local',
    isDeleted: true
  };
};
// --------------------------------------

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [foods, setFoods] = useState<Food[]>([]);
  const [sheetUrl, setSheetUrl] = useState<string>(() => {
    return localStorage.getItem('fiber_track_sheet_url') || '';
  });
  const [view, setView] = useState<'timeline' | 'database'>('timeline');
  const [isMealModalOpen, setIsMealModalOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // --------------------------------------
  // Root-level Auth Handler
  // --------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setSessionLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setSessionLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Fetch Meals from Supabase
  useEffect(() => {
    if (!user) return;

    const fetchMeals = async () => {
      const { data, error } = await supabase
        .from('meals')
        .select(`
          *,
          meal_items (
            food_id,
            grams
          )
        `)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching meals:', error);
      } else if (data) {
        const mappedMeals = data.map((meal: any) => ({
          ...meal,
          items: (meal.meal_items || []).map((mi: any) => ({
            foodId: mi.food_id,
            quantityGrams: mi.grams
          }))
        }));
        setMeals(mappedMeals);
      } else {
        setMeals([]);
      }
    };

    fetchMeals();
  }, [user]);

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
        if (!combinedFoods.find(f => f.name === local.name)) {
          combinedFoods.push(local);
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

  // Persistent storage effects for settings only
  useEffect(() => {
    localStorage.setItem('fiber_track_sheet_url', sheetUrl);
  }, [sheetUrl]);

  const dailyTotals = useMemo(() => {
    return meals.reduce((acc, meal) => {
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId),
        quantity: item.quantityGrams
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
      };
    }, {
      calories: 0, carbs: 0, protein: 0, fat: 0,
      soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0
    });
  }, [meals, foods]);

  const sortedMeals = useMemo(() => {
    return [...meals].sort((a, b) => a.time.localeCompare(b.time));
  }, [meals]);

  const handleSaveMeal = async (meal: Partial<Meal>) => {
    if (!user) throw new Error("User not authenticated.");

    // Manually strictly construct payload to avoid bad columns
    const mealPayload: any = {
      name: meal.name,
      time: meal.time,
      user_id: user.id
    };

    if (meal.id) {
      mealPayload.id = meal.id;
    }

    const { data: insertedMeal, error } = await supabase
      .from('meals')
      .upsert(mealPayload)
      .select()
      .single();

    if (error) {
      console.error('Error saving meal:', error);
      throw new Error(error.message || 'Failed to save meal info.');
    }

    if (meal.items && meal.items.length > 0) {
      if (meal.id) {
        await supabase.from('meal_items').delete().eq('meal_id', meal.id);
      }
      
      const itemsToInsert = meal.items?.map(item => ({
        meal_id: insertedMeal.id,
        food_id: item.foodId,
        grams: item.quantityGrams
      })) || [];

      const { error: itemsError } = await supabase.from('meal_items').insert(itemsToInsert);
      if (itemsError) {
        console.error('Error saving meal items:', itemsError);
        throw new Error(itemsError.message || 'Failed to save meal items.');
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

  return (
    <div className="min-h-screen bg-bg text-ink font-sans flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border px-6 py-10 sm:px-16 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
        <div className="title-group">
          <h1 className="text-[14px] uppercase tracking-[0.1em] text-subtle font-bold mb-2">Fiber Intake Today</h1>
          <div className="text-[84px] font-[800] leading-[0.9] tracking-[-3px]">
            {dailyTotals.total_fiber.toFixed(1)}
            <span className="text-subtle text-[40px] tracking-[-1px] ml-2">/ 35g</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-8 pb-2">
          <StatCard label="Calories" value={Math.round(dailyTotals.calories).toLocaleString()} unit="" />
          <StatCard label="Carbs" value={Math.round(dailyTotals.carbs)} unit="g" />
          <StatCard label="Protein" value={Math.round(dailyTotals.protein)} unit="g" />
          <StatCard label="Fat" value={Math.round(dailyTotals.fat)} unit="g" />
        </div>

        <div className="absolute top-4 right-6 flex items-center gap-2">
          <button
            onClick={() => setView(view === 'timeline' ? 'database' : 'timeline')}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-subtle"
            title={view === 'timeline' ? "Database" : "Timeline"}
          >
            {view === 'timeline' ? <Database size={20} /> : <Clock size={20} />}
          </button>
          <button
            onClick={handleLogout}
            className="p-2 hover:bg-red-50 text-subtle hover:text-red-500 rounded-full transition-colors"
            title="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className={cn(
        "flex-1 overflow-hidden",
        view === 'timeline' ? "grid grid-cols-1 lg:grid-cols-[1fr_360px]" : "max-w-4xl mx-auto w-full p-6"
      )}>
        {view === 'timeline' ? (
          <>
            {/* Timeline Container */}
            <div className="p-10 sm:p-16 border-r border-border bg-bg overflow-y-auto">
              {meals.length === 0 && !isLoading && (
                <div className="flex flex-col items-center justify-center h-64 text-subtle italic">
                  <Clock size={48} className="mb-4 opacity-20" />
                  <p>No meals tracked yet for today.</p>
                  <button
                    onClick={() => setIsMealModalOpen(true)}
                    className="mt-4 text-accent font-bold uppercase tracking-widest text-[12px] hover:underline"
                  >
                    Log your first meal
                  </button>
                </div>
              )}
              <div className="relative border-l border-border ml-16 min-h-[1200px]">
                {Array.from({ length: 25 }).map((_, i) => (
                  <div key={i} className="absolute w-full" style={{ top: `${(i / 24) * 100}%` }}>
                    <div className="absolute -left-16 w-12 text-right text-[12px] text-subtle font-medium">
                      {String(i).padStart(2, '0')}:00
                    </div>

                    {/* Meals at this hour */}
                    <div className="ml-5 space-y-4">
                      {sortedMeals.filter(m => parseInt(m.time.split(':')[0]) === i).map(meal => (
                        <MealBlock
                          key={meal.id}
                          meal={meal}
                          foods={foods}
                          onEdit={() => {
                            setEditingMeal(meal);
                            setIsMealModalOpen(true);
                          }}
                          onDelete={() => handleDeleteMeal(String(meal.id))}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail Panel / Sidebar */}
            <aside className="hidden lg:flex flex-col bg-card p-10 gap-8 overflow-y-auto border-l border-border">
              <div className="detail-header">
                <h2 className="text-[24px] font-[800] tracking-[-0.5px]">Meal Details</h2>
                <p className="text-subtle text-[13px] mt-1">Select a meal to see breakdown</p>
              </div>

              {sortedMeals.length > 0 ? (
                <div className="space-y-8">
                  {/* Show first meal as detail by default, or could be selection state */}
                  {sortedMeals.slice(0, 1).map(meal => {
                    const mealItems = (meal.items || []).map(item => ({
                      food: getFoodOrUnknown(foods, item.foodId),
                      quantity: item.quantityGrams
                    }));
                    const totals = calculateMealTotals(mealItems);

                    return (
                      <div key={meal.id} className="space-y-6">
                        <div className="bg-gray-50 p-4 rounded-xl border border-border">
                          <h3 className="font-bold text-lg">{meal.name}</h3>
                          <p className="text-xs text-subtle">{meal.time}</p>
                        </div>

                        <ul className="space-y-0">
                          {mealItems.map((item, i) => (
                            <li key={i} className="flex justify-between items-center py-3 border-b border-border last:border-0">
                              <div className="food-info">
                                <h4 className={cn("text-[14px]", !item.food.isDeleted ? "font-semibold" : "text-red-500 italic")}>{item.food.name}</h4>
                                <p className="text-[12px] text-subtle">{item.quantity}g</p>
                              </div>
                              <div className="font-mono font-bold text-[14px]">
                                {(item.food.total_fiber * item.quantity / 100).toFixed(1)}g
                              </div>
                            </li>
                          ))}
                        </ul>

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
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-subtle text-sm italic">
                  No meals logged today
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

      {/* Floating Action Button */}
      {view === 'timeline' && (
        <button
          onClick={() => {
            setEditingMeal(null);
            setIsMealModalOpen(true);
          }}
          className="fixed bottom-8 right-8 w-14 h-14 bg-green-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-green-700 transition-transform active:scale-95 z-20"
        >
          <Plus size={28} />
        </button>
      )}

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
      </AnimatePresence>
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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

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
      setMessage({ type: 'error', text: error.message });
    } else {
      if (!isLoginMode && data?.user && !data?.session) {
        setMessage({ type: 'success', text: 'Account created! Please check your email to confirm.' });
      }
      // If it successfully created a session, Supabase's global onAuthStateChange catches it and updates <App /> automatically.
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
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-black transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : (isLoginMode ? 'Sign In' : 'Create Account')}
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

        <div className="pt-4 border-t border-border flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setMessage(null);
            }}
            className="text-[12px] font-bold text-subtle hover:text-ink transition-colors"
          >
            {isLoginMode ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
          <p className="text-[10px] text-subtle/50 uppercase tracking-widest font-bold">Powered by Supabase</p>
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
    <div className="flex flex-col">
      <span className="text-[24px] font-[700] tracking-[-0.5px]">{value}{unit}</span>
      <span className="text-[11px] uppercase text-subtle font-semibold mt-1 tracking-wider">{label}</span>
    </div>
  );
}

interface MealBlockProps {
  key?: string | number;
  meal: Meal;
  foods: Food[];
  onEdit: () => void;
  onDelete: () => void;
}

function MealBlock({ meal, foods, onEdit, onDelete }: MealBlockProps) {
  const mealItems = (meal.items || []).map(item => ({
    food: getFoodOrUnknown(foods, item.foodId),
    quantity: item.quantityGrams
  }));

  const totals = calculateMealTotals(mealItems);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-card border border-border border-l-4 border-l-accent rounded-lg p-4 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:shadow-md transition-all cursor-pointer group w-full max-w-md"
      onClick={onEdit}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[12px] text-accent font-bold mb-1">{meal.time}</div>
          <h3 className="text-[18px] font-bold">{meal.name}</h3>
          <div className="inline-block mt-2 text-[12px] font-semibold bg-[#DCFCE7] text-[#166534] px-2 py-0.5 rounded">
            {totals.total_fiber.toFixed(1)}g Fiber
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 text-subtle hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={16} />
        </button>
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
    
    for (const item of items) {
      if (item.quantityGrams === '' || !item.quantityGrams || Number(item.quantityGrams) <= 0) {
        setErrorMsg("All foods must have a valid quantity greater than 0g.");
        return;
      }
    }

    setIsSaving(true);
    try {
      await onSave({
        ...(editingMeal ? { id: editingMeal.id } : {}),
        name: trimmedName,
        time,
        items: items.map(item => ({ ...item, quantityGrams: Number(item.quantityGrams) }))
      } as Meal);
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred while saving.');
      setIsSaving(false);
    }
  };

  const filteredFoods = foods
    .filter(f => (f.name || '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 5);

  console.log('SEARCH INPUT:', search);
  console.log('FILTERED FOODS:', filteredFoods);
  console.log('ALL FOODS IN MODAL:', foods.length);

  const addItem = (food: Food) => {
    setItems([...items, { foodId: food.id, quantityGrams: 100 }]);
    setSearch('');
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, val: any) => {
    setItems(items.map((item, i) => i === index ? { ...item, quantityGrams: val } : item));
  };

  const mealTotals = useMemo(() => {
    const mealItems = items.map(item => ({
      food: getFoodOrUnknown(foods, item.foodId),
      quantity: Number(item.quantityGrams) // Ensure numbers
    }));
    return calculateMealTotals(mealItems);
  }, [items, foods]);

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
        className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold">{editingMeal ? 'Edit Meal' : 'New Meal'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Add Foods</label>
              <div className="relative z-50">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search database..."
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500 transition-all"
                />
                {search && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] border border-gray-100 z-[100] max-h-60 overflow-y-auto">
                    {filteredFoods.map(food => (
                      <button
                        key={food.id}
                        onClick={() => addItem(food)}
                        className="w-full px-4 py-3 text-left hover:bg-green-50 flex justify-between items-center transition-colors"
                      >
                        <span className="font-medium">{food.name}</span>
                        <span className="text-xs text-gray-400">{food.total_fiber}g fiber / 100g</span>
                      </button>
                    ))}
                    {filteredFoods.length === 0 && (
                      <div className="px-4 py-3 text-gray-400 text-sm">No foods found</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {items.map((item, i) => {
                const food = getFoodOrUnknown(foods, item.foodId);
                return (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl">
                    <div className="flex-1">
                      <div className={cn("font-medium text-sm", food.isDeleted && 'text-red-500 italic')}>{food.name}</div>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                        {(food.total_fiber * Number(item.quantityGrams) / 100).toFixed(1)}g Fiber
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={item.quantityGrams}
                        onFocus={(e) => { e.target.value = ''; updateQuantity(i, ''); }}
                        onClick={(e) => { e.target.value = ''; updateQuantity(i, ''); }}
                        onChange={e => updateQuantity(i, e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-20 px-2 py-1 bg-white border border-gray-200 rounded-lg text-sm text-center"
                      />
                      <span className="text-xs text-gray-400">g</span>
                      <button onClick={() => removeItem(i)} className="p-1 text-gray-300 hover:text-red-500"><X size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-4">
          {errorMsg && (
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-100 flex items-center justify-between">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="p-1 hover:bg-red-100 rounded-full text-red-400 hover:text-red-600 transition-colors">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="flex justify-between items-center">
            <div className="flex gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{mealTotals.total_fiber.toFixed(1)}g</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fiber</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">{Math.round(mealTotals.calories)}</div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Kcal</div>
              </div>
            </div>
            <button
              onClick={handleSaveClick}
              disabled={isSaving}
              className="px-8 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg shadow-green-200 hover:bg-green-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="animate-spin" size={20} /> : 'Save Meal'}
            </button>
          </div>
        </div>
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
  const [newFood, setNewFood] = useState<Partial<Food>>({
    name: '', calories: 0, carbs: 0, protein: 0, fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0
  });

  const filteredFoods = foods.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

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
    setNewFood({ name: '', calories: 0, carbs: 0, protein: 0, fat: 0, soluble_fiber: 0, insoluble_fiber: 0, total_fiber: 0 });
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
                <tr key={food.id} className="group">
                  <td className="py-4 font-medium">{food.name}</td>
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
                  <input type="text" value={newFood.name} onChange={e => setNewFood({ ...newFood, name: e.target.value })} className="w-full px-4 py-2 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-green-500" />
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


import React, { useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, PieChart, Pie, Legend
} from 'recharts';
import { format, subDays, isSameDay, parseISO, startOfDay, startOfWeek, endOfWeek, addDays, differenceInDays } from 'date-fns';
import { Meal, Food } from '../types';
import { calculateMealTotals, getFoodOrUnknown, cn } from '../lib/utils';
import { Loader2, TrendingUp, Pizza, Award, Clock } from 'lucide-react';

interface StatisticsViewProps {
  meals: Meal[];
  foods: Food[];
  days: 7 | 30;
  setDays: (days: 7 | 30) => void;
  isLoading: boolean;
  weightLogs?: any[];
}

export default function StatisticsView({ meals, foods, days, setDays, isLoading, weightLogs = [] }: StatisticsViewProps) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'thisWeek'>('overview');
  
  const stats = useMemo(() => {
    // 1. Daily Trends
    const endDate = new Date();
    const dateRange = Array.from({ length: days }).map((_, i) => subDays(endDate, days - 1 - i));
    
    const dailyData = dateRange.map(date => {
      const dayMeals = meals.filter(meal => isSameDay(new Date(meal.created_at || ''), date));
      
      const totals = dayMeals.reduce((acc, meal) => {
        const mealItems = (meal.items || []).map(item => ({
          food: getFoodOrUnknown(foods, item.foodId),
          quantity: item.quantityGrams
        }));
        const mealTotals = calculateMealTotals(mealItems);
        return {
          total_fiber: acc.total_fiber + mealTotals.total_fiber,
          gl: acc.gl + mealTotals.gl
        };
      }, { total_fiber: 0, gl: 0 });

      return {
        date: format(date, 'MMM dd'),
        fiber: Number(totals.total_fiber.toFixed(1)),
        gl: Number(totals.gl.toFixed(1))
      };
    });

    // 2. Meal Distribution
    const mealDistMap: Record<string, number> = {};
    meals.forEach(meal => {
      const name = meal.name.trim() || 'Other';
      const normalizedName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId),
        quantity: item.quantityGrams
      }));
      const mealTotals = calculateMealTotals(mealItems);
      
      mealDistMap[normalizedName] = (mealDistMap[normalizedName] || 0) + mealTotals.total_fiber;
    });

    const mealDistData = Object.entries(mealDistMap)
      .map(([name, fiber]) => ({ name, fiber: Number(fiber.toFixed(1)) }))
      .sort((a, b) => b.fiber - a.fiber);

    // 3. Top Foods
    const foodFiberMap: Record<string, number> = {};
    meals.forEach(meal => {
      (meal.items || []).forEach(item => {
        const food = getFoodOrUnknown(foods, item.foodId);
        const fiberContribution = (food.total_fiber * item.quantityGrams) / 100;
        const foodName = food.name_hu || 'Unknown';
        foodFiberMap[foodName] = (foodFiberMap[foodName] || 0) + fiberContribution;
      });
    });

    const topFoodsData = Object.entries(foodFiberMap)
      .map(([name, fiber]) => ({ name, fiber: Number(fiber.toFixed(1)) }))
      .sort((a, b) => b.fiber - a.fiber)
      .slice(0, 5);

    // 4. Averages
    const avgFiber = dailyData.reduce((sum, d) => sum + d.fiber, 0) / days;
    const avgGL = dailyData.reduce((sum, d) => sum + d.gl, 0) / days;



    return { dailyData, mealDistData, topFoodsData, avgFiber, avgGL };
  }, [meals, foods, days]);

  const maintenanceStats = useMemo(() => {
    if (!weightLogs || weightLogs.length < 3) {
      return { tdee: null, trend: 'stable' };
    }

    const sortedLogs = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date));
    const dayCalorieMap: Record<string, number> = {};
    
    meals.forEach(meal => {
      const dateStr = format(new Date(meal.created_at || ''), 'yyyy-MM-dd');
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId),
        quantity: item.quantityGrams
      }));
      const mealTotals = calculateMealTotals(mealItems);
      dayCalorieMap[dateStr] = (dayCalorieMap[dateStr] || 0) + mealTotals.calories;
    });

    const now = new Date();
    const cutoff = subDays(now, 30);
    const activeWeights = sortedLogs.filter(log => new Date(log.date) >= cutoff);

    if (activeWeights.length < 3) {
      return { tdee: null, trend: 'stable' };
    }

    const firstDate = new Date(activeWeights[0].date);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = activeWeights.length;

    activeWeights.forEach(log => {
      const x = differenceInDays(new Date(log.date), firstDate);
      const y = log.weight;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const denominator = (n * sumX2 - sumX * sumX);
    const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator; 

    const lastDate = new Date(activeWeights[activeWeights.length - 1].date);
    const totalDays = Math.max(1, differenceInDays(lastDate, firstDate));

    let totalCals = 0;
    let calDays = 0;
    const dateIter = new Date(firstDate);
    while (dateIter <= lastDate) {
      const dStr = format(dateIter, 'yyyy-MM-dd');
      totalCals += dayCalorieMap[dStr] || 0;
      calDays++;
      dateIter.setDate(dateIter.getDate() + 1);
    }

    const avgDailyCalories = totalCals / (calDays || 1);
    const dailySurplus = slope * 7700;
    const tdee = avgDailyCalories - dailySurplus;
    
    return {
      tdee: tdee > 0 ? Math.round(tdee) : null,
      trend: slope > 0.05 ? 'up' : slope < -0.05 ? 'down' : 'stable',
    };
  }, [weightLogs, meals, foods]);
  const thisWeekStats = useMemo(() => {
    const now = new Date();
    const start = startOfWeek(now, { weekStartsOn: 1 });
    const end = endOfWeek(now, { weekStartsOn: 1 });
    
    const weekMeals = meals.filter(meal => {
      const mealDate = new Date(meal.created_at || '');
      return mealDate >= start && mealDate <= end;
    });

    const uniqueVeg = new Set<string>();
    const vegFreqMap: Record<string, { name: string, count: number, grams: number }> = {};
    let totalVegGrams = 0;
    
    const categoryGrams: Record<string, number> = { vegetable: 0, other: 0 };

    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalCalories = 0;
    let totalGL = 0;

    weekMeals.forEach(meal => {
      const mealItems = (meal.items || []).map(item => ({
        food: getFoodOrUnknown(foods, item.foodId),
        quantity: item.quantityGrams
      }));
      const mealTotals = calculateMealTotals(mealItems);
      
      totalProtein += mealTotals.protein;
      totalCarbs += mealTotals.carbs;
      totalFat += mealTotals.fat;
      totalCalories += mealTotals.calories;
      totalGL += mealTotals.gl;

      (meal.items || []).forEach(item => {
        const food = getFoodOrUnknown(foods, item.foodId);
        const cat = food.category || 'other';
        const catKey = cat === 'vegetable' ? cat : 'other';
        categoryGrams[catKey] += item.quantityGrams;

        if (cat === 'vegetable') {
          const name = food.name_hu || 'Unknown';
          uniqueVeg.add(name);
          
          if (!vegFreqMap[name]) {
            vegFreqMap[name] = { name, count: 0, grams: 0 };
          }
          vegFreqMap[name].count += 1;
          vegFreqMap[name].grams += item.quantityGrams;
          totalVegGrams += item.quantityGrams;
        }
      });
    });

    const vegFreqData = Object.values(vegFreqMap)
      .sort((a, b) => b.grams - a.grams);

    const categoryDistData = Object.entries(categoryGrams)
      .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value: Number(value.toFixed(1)) }))
      .filter(d => d.value > 0);

    const macroDistData = [
      { name: 'Protein', value: Number(totalProtein.toFixed(1)) },
      { name: 'Carbs', value: Number(totalCarbs.toFixed(1)) },
      { name: 'Fat', value: Number(totalFat.toFixed(1)) },
    ].filter(d => d.value > 0);

    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(start, i));
    const dailyMacroData = weekDays.map(date => {
      const dayMeals = weekMeals.filter(meal => isSameDay(new Date(meal.created_at || ''), date));
      const totals = dayMeals.reduce((acc, meal) => {
        const mealItems = (meal.items || []).map(item => ({
          food: getFoodOrUnknown(foods, item.foodId),
          quantity: item.quantityGrams
        }));
        const mealTotals = calculateMealTotals(mealItems);
        return {
          calories: acc.calories + mealTotals.calories,
          protein: acc.protein + mealTotals.protein,
          carbs: acc.carbs + mealTotals.carbs,
          fat: acc.fat + mealTotals.fat,
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      return {
        date: format(date, 'EEE'),
        calories: Number(totals.calories.toFixed(0)),
        protein: Number(totals.protein.toFixed(1)),
        carbs: Number(totals.carbs.toFixed(1)),
        fat: Number(totals.fat.toFixed(1)),
      };
    });

    return {
      uniqueVeg: Array.from(uniqueVeg),
      vegFreqData,
      totalVegGrams: Number(totalVegGrams.toFixed(1)),
      categoryDistData,
      macroDistData,
      dailyMacroData,
      overview: {
        protein: totalProtein,
        carbs: totalCarbs,
        fat: totalFat,
        calories: totalCalories,
        gl: totalGL,
      }
    };
  }, [meals, foods]);
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Loader2 className="animate-spin text-accent mb-4" size={48} />
        <p className="text-subtle font-medium">Analyzing your data...</p>
      </div>
    );
  }

  if (meals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-6">
        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
          <TrendingUp size={40} className="text-subtle/20" />
        </div>
        <h3 className="text-xl font-bold mb-2">No data for this period</h3>
        <p className="text-subtle text-sm max-w-sm">Log some meals in the timeline to see your nutritional insights here.</p>
        <div className="mt-8 flex gap-2">
          <button 
            onClick={() => setDays(7)}
            className={cn("px-4 py-2 rounded-xl border text-sm font-bold transition-all", days === 7 ? "bg-ink text-white border-ink" : "bg-white text-subtle border-border")}
          >
            7 Days
          </button>
          <button 
            onClick={() => setDays(30)}
            className={cn("px-4 py-2 rounded-xl border text-sm font-bold transition-all", days === 30 ? "bg-ink text-white border-ink" : "bg-white text-subtle border-border")}
          >
            30 Days
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-[800] tracking-tight">Statistics</h2>
          <p className="text-subtle text-sm">Nutritional insights</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="bg-gray-100/50 p-1 rounded-2xl flex gap-1">
            <button 
              onClick={() => setActiveTab('overview')}
              className={cn(
                "px-6 py-2 rounded-xl text-sm font-bold transition-all",
                activeTab === 'overview' ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
              )}
            >
              Overview
            </button>
            <button 
              onClick={() => setActiveTab('thisWeek')}
              className={cn(
                "px-6 py-2 rounded-xl text-sm font-bold transition-all",
                activeTab === 'thisWeek' ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
              )}
            >
              This Week
            </button>
          </div>

          {activeTab === 'overview' && (
            <div className="bg-gray-100/50 p-1 rounded-2xl flex gap-1">
              <button 
                onClick={() => setDays(7)}
                className={cn(
                  "px-6 py-2 rounded-xl text-sm font-bold transition-all",
                  days === 7 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
                )}
              >
                7 Days
              </button>
              <button 
                onClick={() => setDays(30)}
                className={cn(
                  "px-6 py-2 rounded-xl text-sm font-bold transition-all",
                  days === 30 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
                )}
              >
                30 Days
              </button>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'overview' ? (<>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatSummaryCard 
          label="Avg Daily Fiber" 
          value={stats.avgFiber.toFixed(1)} 
          unit="g" 
          icon={<TrendingUp size={20} />}
          color="bg-green-50 text-green-600"
        />
        <StatSummaryCard 
          label="Avg Daily GL" 
          value={stats.avgGL.toFixed(1)} 
          unit="" 
          icon={<Award size={20} />}
          color="bg-orange-50 text-orange-600"
        />
        <StatSummaryCard 
          label="Top Meal" 
          value={stats.mealDistData[0]?.name || 'N/A'} 
          unit="" 
          icon={<Pizza size={20} />}
          color="bg-blue-50 text-blue-600"
        />
        <StatSummaryCard 
          label="Total Meals" 
          value={meals.length.toString()} 
          unit="" 
          icon={<Clock size={20} />}
          color="bg-purple-50 text-purple-600"
        />
        <StatSummaryCard 
          label="Maintenance Kcal" 
          value={maintenanceStats.tdee ? maintenanceStats.tdee.toString() : 'N/A'} 
          unit={maintenanceStats.tdee ? "kcal/day" : ""} 
          icon={<TrendingUp size={20} />}
          color="bg-red-50 text-red-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weight Trend */}
        <ChartContainer title="Weight Trend" subtitle="Body weight over time (kg)">
          {weightLogs && weightLogs.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={[...weightLogs].sort((a, b) => a.date.localeCompare(b.date))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fontSize: 12, fill: '#94a3b8'}}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  domain={['dataMin - 1', 'dataMax + 1']}
                  tick={{fontSize: 12, fill: '#94a3b8'}}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{ stroke: '#8b5cf6', strokeWidth: 2 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="weight" 
                  stroke="#8b5cf6" 
                  strokeWidth={4} 
                  dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-subtle text-sm italic flex items-center justify-center h-60">Log weight in timeline to view trend.</p>
          )}
        </ChartContainer>
        {/* Daily Fiber Trend */}
        <ChartContainer title="Daily Fiber Trend" subtitle="Daily total fiber intake (grams)">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={stats.dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 12, fill: '#94a3b8'}}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 12, fill: '#94a3b8'}}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                cursor={{ stroke: '#10b981', strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="fiber" 
                stroke="#10b981" 
                strokeWidth={4} 
                dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* Daily GL Trend */}
        <ChartContainer title="Daily GL Trend" subtitle="Daily Glycemic Load total">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={stats.dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 12, fill: '#94a3b8'}}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 12, fill: '#94a3b8'}}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                cursor={{ stroke: '#f59e0b', strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="gl" 
                stroke="#f59e0b" 
                strokeWidth={4} 
                dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* Meal Distribution */}
        <ChartContainer title="Meal Distribution" subtitle="Fiber contribution by meal type">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stats.mealDistData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" hide />
              <YAxis 
                dataKey="name" 
                type="category" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 12, fontWeight: 700, fill: '#1e293b'}}
                width={100}
              />
              <Tooltip 
                cursor={{fill: 'transparent'}}
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="fiber" radius={[0, 8, 8, 0]}>
                {stats.mealDistData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'][index % 5]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>

        {/* Top Foods */}
        <ChartContainer title="Top 5 Fiber Sources" subtitle="Foods providing the most fiber">
          <div className="space-y-4">
            {stats.topFoodsData.map((food, index) => (
              <div key={food.name} className="flex items-center gap-4">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0",
                  index === 0 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-400"
                )}>
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-sm truncate">{food.name}</span>
                    <span className="font-mono text-xs text-subtle">{food.fiber}g</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-accent rounded-full" 
                      style={{ width: `${(food.fiber / stats.topFoodsData[0].fiber) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ChartContainer>
        </div>
        </>
      ) : (
        <div className="space-y-8 animate-in fade-in duration-500">
          {/* This Week Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatSummaryCard label="Protein" value={(thisWeekStats.overview.protein / 7).toFixed(1)} unit="g avg/day" icon={<Award size={20} />} color="bg-blue-50 text-blue-600" />
            <StatSummaryCard label="Carbs" value={(thisWeekStats.overview.carbs / 7).toFixed(1)} unit="g avg/day" icon={<Award size={20} />} color="bg-orange-50 text-orange-600" />
            <StatSummaryCard label="Fat" value={(thisWeekStats.overview.fat / 7).toFixed(1)} unit="g avg/day" icon={<Award size={20} />} color="bg-purple-50 text-purple-600" />
            <StatSummaryCard label="Calories" value={(thisWeekStats.overview.calories / 7).toFixed(0)} unit="kcal avg/day" icon={<TrendingUp size={20} />} color="bg-green-50 text-green-600" />
            <StatSummaryCard label="Glycemic Load" value={(thisWeekStats.overview.gl / 7).toFixed(1)} unit="avg/day" icon={<TrendingUp size={20} />} color="bg-red-50 text-red-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartContainer title="Vegetable Diversity" subtitle="Unique vegetables eaten this week">
              <div className="space-y-6">
                <div className="flex items-center gap-4 bg-green-50/50 p-6 rounded-2xl border border-green-100">
                  <div className="text-3xl font-black text-green-600">{thisWeekStats.uniqueVeg.length}</div>
                  <div className="text-sm font-bold text-ink">Unique vegetables consumed</div>
                </div>
                
                {thisWeekStats.uniqueVeg.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {thisWeekStats.uniqueVeg.map(veg => (
                      <span key={veg} className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold shadow-sm">
                        {veg}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-subtle text-sm italic">No vegetables logged yet for this period.</p>
                )}

                <div className="pt-4 border-t border-gray-100">
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Total Volume</div>
                  <div className="text-2xl font-black text-ink">{thisWeekStats.totalVegGrams} <span className="text-sm text-subtle">g</span></div>
                </div>
              </div>
            </ChartContainer>

            <ChartContainer title="Most Frequent Vegetables" subtitle="Top vegetables by intake weight">
              {thisWeekStats.vegFreqData.length > 0 ? (
                <div className="space-y-4">
                  {thisWeekStats.vegFreqData.slice(0, 5).map((veg, index) => (
                    <div key={veg.name} className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-xs font-black text-green-700 shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="font-bold text-sm truncate">{veg.name}</span>
                          <span className="font-mono text-xs text-subtle">{veg.grams}g ({veg.count}×)</span>
                        </div>
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-green-500 rounded-full" 
                            style={{ width: `${(veg.grams / thisWeekStats.vegFreqData[0].grams) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-subtle text-sm italic flex items-center justify-center h-40">No data</p>
              )}
            </ChartContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartContainer title="Food Category Breakdown" subtitle="Grams consumed per category">
              {thisWeekStats.categoryDistData.length > 0 ? (
                <div className="flex flex-col md:flex-row items-center justify-around gap-6">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={thisWeekStats.categoryDistData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {thisWeekStats.categoryDistData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#10b981', '#f59e0b', '#6b7280'][index % 3]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  
                  <div className="space-y-3 w-full md:w-48 shrink-0">
                    {thisWeekStats.categoryDistData.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ['#10b981', '#f59e0b', '#6b7280'][index % 3] }} />
                          <span className="text-sm font-medium">{item.name}</span>
                        </div>
                        <span className="text-xs font-bold text-subtle">{item.value}g</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-subtle text-sm italic flex items-center justify-center h-40">No data</p>
              )}
            </ChartContainer>

            <ChartContainer title="Macro Distribution" subtitle="Relative ratio of core macronutrients">
              {thisWeekStats.macroDistData.length > 0 ? (
                <div className="flex flex-col md:flex-row items-center justify-around gap-6">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={thisWeekStats.macroDistData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {thisWeekStats.macroDistData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#6366f1', '#f59e0b', '#a855f7'][index % 3]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="space-y-3 w-full md:w-48 shrink-0">
                    {thisWeekStats.macroDistData.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ['#6366f1', '#f59e0b', '#a855f7'][index % 3] }} />
                          <span className="text-sm font-medium">{item.name}</span>
                        </div>
                        <span className="text-xs font-bold text-subtle">{item.value}g</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-subtle text-sm italic flex items-center justify-center h-40">No data</p>
              )}
            </ChartContainer>
          </div>

          <ChartContainer title="Daily Macro Breakdown" subtitle="Calories, Protein, Carbs, and Fat consumed by day of week">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={thisWeekStats.dailyMacroData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#94a3b8'}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#94a3b8'}} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Bar dataKey="protein" stackId="a" fill="#6366f1" name="Protein (g)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="carbs" stackId="a" fill="#f59e0b" name="Carbs (g)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="fat" stackId="a" fill="#a855f7" name="Fat (g)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      )}
    </div>
  );
}

function StatSummaryCard({ label, value, unit, icon, color }: { label: string, value: string, unit: string, icon: React.ReactNode, color: string }) {
  return (
    <div className="bg-white p-6 rounded-[2rem] border border-border flex items-center gap-4 shadow-sm">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", color)}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-subtle mb-0.5">{label}</p>
        <p className="text-xl font-black text-ink">
          {value}<span className="text-xs font-bold text-subtle ml-0.5">{unit}</span>
        </p>
      </div>
    </div>
  );
}

function ChartContainer({ title, subtitle, children }: { title: string, subtitle: string, children: React.ReactNode }) {
  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm">
      <div className="mb-8">
        <h3 className="text-xl font-[800] tracking-tight">{title}</h3>
        <p className="text-subtle text-xs font-medium">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

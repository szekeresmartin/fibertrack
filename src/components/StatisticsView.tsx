import React, { useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, PieChart, Pie, Legend
} from 'recharts';
import { format, subDays, isSameDay, parseISO, startOfDay } from 'date-fns';
import { Meal, Food } from '../types';
import { calculateMealTotals, getFoodOrUnknown, cn } from '../lib/utils';
import { Loader2, TrendingUp, Pizza, Award, Clock } from 'lucide-react';

interface StatisticsViewProps {
  meals: Meal[];
  foods: Food[];
  days: 7 | 30;
  setDays: (days: 7 | 30) => void;
  isLoading: boolean;
}

export default function StatisticsView({ meals, foods, days, setDays, isLoading }: StatisticsViewProps) {
  
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
          <p className="text-subtle text-sm">Nutritional insights for the last {days} days</p>
        </div>
        
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
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

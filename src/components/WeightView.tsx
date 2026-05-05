import React, { useMemo, useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, differenceInDays } from 'date-fns';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Meal, Food } from '../types';
import { calculateMealTotals, getFoodOrUnknown, cn } from '../lib/utils';
import { WeightLog } from '../lib/weightUtils';
import { useWeightLogs, useUpsertWeightLog } from '../lib/queries/weightQueries';
import { useWeightStats } from '../lib/hooks/useWeightStats';
import { useWeightChartData } from '../lib/hooks/useWeightChartData';

interface WeightViewProps {
  userId: string;
  selectedDate: Date;
  meals: Meal[];
  foods: Food[];
}

export default function WeightView({ userId, selectedDate, meals, foods }: WeightViewProps) {
  const [rangeDays, setRangeDays] = useState<30 | 90 | 180>(30);
  const { data: weightLogs = [] } = useWeightLogs(userId);
  const upsertWeightLog = useUpsertWeightLog();

  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const currentLog = useMemo(() => weightLogs.find(l => l.date === dateStr), [weightLogs, dateStr]);

  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    setInputValue(currentLog ? currentLog.weight.toString() : '');
  }, [currentLog, selectedDate]);

  useEffect(() => {
    if (!inputValue) return;
    if (currentLog && currentLog.weight.toString() === inputValue) return;

    const timer = setTimeout(() => {
      const val = parseFloat(inputValue);
      if (!isNaN(val) && val > 0) {
        upsertWeightLog.mutate({ userId, date: dateStr, weight: val });
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [inputValue, dateStr, currentLog, userId, upsertWeightLog]);

  const weightStats = useWeightStats(weightLogs, meals, foods);

  const chartData = useWeightChartData(weightLogs, rangeDays);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 py-6">
      <div className="mb-8">
        <h2 className="text-3xl font-[800] tracking-tight">Weight & Body</h2>
        <p className="text-subtle text-sm">Track your progress and maintenance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Weight Input */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col justify-center items-center text-center">
          <h3 className="text-sm font-bold text-subtle uppercase tracking-widest mb-6">Log Weight for {format(selectedDate, 'MMM d, yyyy')}</h3>
          <div className="flex items-center gap-4 bg-gray-50 px-6 py-4 rounded-3xl border border-gray-100 shadow-inner">
            <input
              type="number"
              step="0.1"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="0.0"
              className="w-32 bg-transparent text-center focus:outline-none font-black text-ink text-5xl"
            />
            <span className="text-2xl font-bold text-subtle/50">kg</span>
          </div>
          <p className="text-xs text-subtle/50 mt-6 italic">Auto-saves when you stop typing</p>
        </div>

        {/* Maintenance Calories */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col justify-center items-center text-center">
          <h3 className="text-sm font-bold text-subtle uppercase tracking-widest mb-6">Estimated Maintenance</h3>
          
          <div className="flex items-center gap-3">
            <div className="text-[56px] font-[800] leading-none text-ink tracking-tight">
              {weightStats.tdee ? weightStats.tdee : '--'}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-sm font-bold text-subtle">kcal</span>
              <span className="text-sm font-bold text-subtle">/ day</span>
            </div>
          </div>

          {weightStats.tdee ? (
            <div className="flex items-center gap-2 mt-6 px-4 py-2 bg-gray-50 rounded-2xl border border-gray-100">
              {weightStats.trendDirection === 'up' ? (
                <TrendingUp size={16} className="text-red-500" />
              ) : weightStats.trendDirection === 'down' ? (
                <TrendingDown size={16} className="text-green-500" />
              ) : (
                <Minus size={16} className="text-gray-400" />
              )}
              <span className="text-xs font-bold text-subtle">
                Trend: {weightStats.weeklyTrend.toFixed(2)} kg/week
              </span>
            </div>
          ) : (
            <p className="text-xs text-subtle/50 mt-6 italic">Log weight and food for 3+ days</p>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h3 className="text-xl font-[800] tracking-tight">Weight Trend</h3>
            <p className="text-subtle text-xs font-medium">Body weight over time (kg)</p>
          </div>
          <div className="bg-gray-100/50 p-1 rounded-2xl flex gap-1">
            <button 
              onClick={() => setRangeDays(30)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                rangeDays === 30 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
              )}
            >
              30D
            </button>
            <button 
              onClick={() => setRangeDays(90)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                rangeDays === 90 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
              )}
            >
              3M
            </button>
            <button 
              onClick={() => setRangeDays(180)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                rangeDays === 180 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink"
              )}
            >
              6M
            </button>
          </div>
        </div>

        {chartData && chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 12, fill: '#94a3b8'}}
                tickFormatter={(val) => format(new Date(val), 'MMM d')}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                domain={['dataMin - 1', 'dataMax + 1']}
                tick={{fontSize: 12, fill: '#94a3b8'}}
                tickFormatter={(val) => val.toFixed(1)}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                cursor={{ stroke: '#8b5cf6', strokeWidth: 2 }}
                labelFormatter={(val) => format(new Date(val), 'MMMM d, yyyy')}
              />
              <Line 
                type="monotone" 
                dataKey="weight" 
                stroke="#8b5cf6" 
                strokeWidth={2} 
                strokeOpacity={0.3}
                dot={{ r: 3, fill: '#8b5cf6', strokeWidth: 1, stroke: '#fff', fillOpacity: 0.5 }}
                activeDot={{ r: 4, strokeWidth: 0 }}
                name="Raw Weight"
              />
              <Line 
                type="monotone" 
                dataKey="movingAverage" 
                stroke="#8b5cf6" 
                strokeWidth={4} 
                dot={false}
                activeDot={{ r: 6, strokeWidth: 0 }}
                name="7-Day Average"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-subtle text-sm italic flex items-center justify-center h-60 bg-gray-50 rounded-3xl border border-dashed border-border">
            No weight logs for this period.
          </p>
        )}
      </div>
    </div>
  );
}

import React, { useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, PieChart, Pie, Legend, ReferenceLine
} from 'recharts';
import { format, addDays, subDays } from 'date-fns';
import { Meal, Food } from '../types';
import { cn, isConservativeVegetable } from '../lib/utils';
import { Loader2, TrendingUp, Pizza, Award, Scale, Flame, Droplets, Wheat, CalendarDays, TriangleAlert } from 'lucide-react';
import { useWeightStats } from '../lib/hooks/useWeightStats';
import { useWeightChartData } from '../lib/hooks/useWeightChartData';
import { useWeightLogs } from '../lib/queries/weightQueries';
import { computeStats } from '../lib/statsUtils';
import { normalizeDateToLocal, parseLocalDateInput } from '../lib/dateUtils';

interface StatisticsViewProps {
  userId: string;
  meals: Meal[];
  foods: Food[];
  days: 7 | 30 | 90 | 3650;
  setDays: (days: 7 | 30 | 90 | 3650) => void;
  isLoading: boolean;
}

export default function StatisticsView({ userId, meals, foods, days, setDays, isLoading }: StatisticsViewProps) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'details'>('overview');
  const { data: weightLogs = [] } = useWeightLogs(userId);
  
  const { weeklyTrend, trendDirection, hasSufficientData, windowLabel } = useWeightStats(weightLogs, meals, foods, days);
  const weightChartData = useWeightChartData(weightLogs, days);
  
  const currentStartDate = useMemo(() => {
    const now = new Date();
    const spanDays = days === 3650 ? 3650 : days;
    return subDays(now, spanDays - 1);
  }, [days]);

  const currentRange = useMemo(() => ({
    start: normalizeDateToLocal(currentStartDate),
    end: normalizeDateToLocal(new Date())
  }), [currentStartDate]);

  const previousRange = useMemo(() => {
    if (days === 3650) return null;
    const previousEnd = subDays(currentStartDate, 1);
    const previousStart = subDays(previousEnd, days - 1);
    return {
      start: normalizeDateToLocal(previousStart),
      end: normalizeDateToLocal(previousEnd)
    };
  }, [currentStartDate, days]);

  const currentMeals = useMemo(() => meals.filter(meal => {
    const key = normalizeDateToLocal(meal.created_at);
    if (!key) return false;
    return key >= currentRange.start && key <= currentRange.end;
  }), [meals, currentRange.start, currentRange.end]);

  const previousMeals = useMemo(() => {
    if (!previousRange) return [];
    return meals.filter(meal => {
      const key = normalizeDateToLocal(meal.created_at);
      if (!key) return false;
      return key >= previousRange.start && key <= previousRange.end;
    });
  }, [meals, previousRange]);

  const previousStats = useMemo(() => {
    if (!previousRange || previousMeals.length === 0) return null;
    return computeStats(previousMeals, foods, previousRange.start, previousRange.end);
  }, [previousMeals, foods, previousRange]);

  const currentStats = useMemo(() => {
    return computeStats(currentMeals, foods, currentRange.start, currentRange.end, previousStats?.aggregates);
  }, [currentMeals, foods, currentRange, previousStats]);

  const topFiberContributors = currentStats?.topSources.fiber.contribution ?? [];
  const topMeals = currentStats?.distributions ?? [];
  const lowFiberDays = useMemo(() => {
    return (currentStats?.calendarDailyData ?? [])
      .filter(day => day.hasMeals && day.metrics.fiber < 35)
      .sort((a, b) => a.metrics.fiber - b.metrics.fiber)
      .slice(0, 8)
      .map(day => ({ date: day.date, metrics: { fiber: day.metrics.fiber, calories: day.metrics.calories } }));
  }, [currentStats?.calendarDailyData]);

  const missingDataDays = useMemo(() => {
    return (currentStats?.calendarDailyData ?? [])
      .filter(day => !day.hasMeals)
      .slice(0, 8)
      .map(day => ({ date: day.date }));
  }, [currentStats?.calendarDailyData]);

  const vegetableStats = useMemo(() => {
    const statsMap: Record<string, { grams: number; count: number }> = {};
    currentMeals.forEach(meal => {
      (meal.items || []).forEach(item => {
        const food = foods.find(f => f.id === item.foodId);
        if (!food || !isConservativeVegetable(food)) return;
        const name = food.name_hu || 'Unknown';
        if (!statsMap[name]) statsMap[name] = { grams: 0, count: 0 };
        statsMap[name].grams += item.quantityGrams;
        statsMap[name].count += 1;
      });
    });
    return Object.entries(statsMap)
      .map(([name, value]) => ({ name, grams: Number(value.grams.toFixed(1)), count: value.count }))
      .sort((a, b) => b.grams - a.grams)
      .slice(0, 8);
  }, [currentMeals, foods]);

  const periodComparison = currentStats?.aggregates.comparisons ?? null;
  const hasComparison = !!previousStats && !!periodComparison;
  const chartDailyData = useMemo(() => {
    if (!currentStats) return [];
    return currentStats.dailyData.map(day => ({
      ...day,
      fiber: day.metrics.fiber,
      gl: day.metrics.gl
    }));
  }, [currentStats]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Loader2 className="animate-spin text-accent mb-4" size={48} />
        <p className="text-subtle font-medium">Analyzing your data...</p>
      </div>
    );
  }

  const fiberChartTitle = currentStats.grouping === 'daily'
    ? 'Daily Fiber Trend'
    : currentStats.grouping === 'weekly'
      ? 'Weekly Fiber Trend'
      : 'Monthly Fiber Trend';
  const fiberRatio = currentStats.aggregates.fiberRatio;

  const rangeLabel = days === 7 ? 'This Week' : days === 30 ? 'Last 30 Days' : 'All Time';
  const weightWindowLabel = windowLabel;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-[800] tracking-tight">Statistics</h2>
            <p className="text-subtle text-sm">{rangeLabel} nutritional insights</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-gray-100/50 p-1 rounded-2xl flex gap-1">
              <button onClick={() => setActiveTab('overview')} className={cn("px-5 py-2 rounded-xl text-sm font-bold transition-all", activeTab === 'overview' ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink")}>Overview</button>
              <button onClick={() => setActiveTab('details')} className={cn("px-5 py-2 rounded-xl text-sm font-bold transition-all", activeTab === 'details' ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink")}>Details</button>
            </div>
            <div className="bg-gray-100/50 p-1 rounded-2xl flex gap-1">
              <button onClick={() => setDays(7)} className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", days === 7 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink")}>This Week</button>
              <button onClick={() => setDays(30)} className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", days === 30 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink")}>Last 30 Days</button>
              <button onClick={() => setDays(3650)} className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all", days === 3650 ? "bg-white text-ink shadow-sm scale-105" : "text-subtle hover:text-ink")}>All Time</button>
            </div>
          </div>
        </div>

        {hasComparison && periodComparison && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ComparisonChip label="Fiber" delta={periodComparison.fiberDelta} percent={periodComparison.fiberPercent} positiveIsGood />
            <ComparisonChip label="GL" delta={periodComparison.glDelta} percent={periodComparison.glPercent} positiveIsGood={false} />
            <ComparisonChip label="Calories" delta={periodComparison.caloriesDelta} percent={periodComparison.caloriesPercent} positiveIsGood={false} />
          </div>
        )}
        {!hasComparison && days !== 3650 && (
          <div className="rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-3 text-sm text-subtle">
            Comparison unavailable because the previous period has no logged meals.
          </div>
        )}
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <StatSummaryCard label="Avg Fiber / day" value={currentStats.aggregates.avgFiber.toFixed(1)} unit="g" icon={<Flame size={20} />} color="bg-green-50 text-green-600" />
            <StatSummaryCard label="Avg Calories / day" value={Math.round(currentStats.aggregates.avgCalories).toString()} unit="kcal" icon={<Flame size={20} />} color="bg-orange-50 text-orange-600" />
            <StatSummaryCard label="Avg Protein / day" value={currentStats.aggregates.avgProtein.toFixed(1)} unit="g" icon={<Award size={20} />} color="bg-blue-50 text-blue-600" />
            <StatSummaryCard label="Avg GL / day" value={currentStats.aggregates.avgGL.toFixed(1)} unit="" icon={<Award size={20} />} color="bg-amber-50 text-amber-600" />
            <StatSummaryCard label="Fiber Goal" value={`${currentStats.aggregates.consistencyScore}%`} unit="days hit" icon={<CalendarDays size={20} />} color="bg-emerald-50 text-emerald-700" />
            <StatSummaryCard label={`Weight Trend (${weightWindowLabel})`} value={!hasSufficientData ? 'Insufficient' : Math.abs(weeklyTrend).toFixed(2)} unit={!hasSufficientData ? '' : `kg/wk ${trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '→'}`} icon={<Scale size={20} />} color={cn("bg-gray-50 text-gray-600", trendDirection === 'down' && hasSufficientData && "bg-green-50 text-green-600", trendDirection === 'up' && hasSufficientData && "bg-red-50 text-red-600")} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <ChartContainer title={fiberChartTitle} subtitle="Fiber intake with 35g goal line">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartDailyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{ stroke: '#10b981', strokeWidth: 2 }} />
                  <ReferenceLine y={35} stroke="#10b981" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="fiber" stroke="#10b981" strokeWidth={4} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>

            <ChartContainer title="Fiber Quality" subtitle="Soluble versus insoluble fiber">
              <div className="space-y-4">
                {fiberRatio?.isVisible ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-blue-50 p-4 border border-blue-100">
                        <div className="text-[10px] font-black uppercase tracking-widest text-blue-700">Soluble</div>
                        <div className="text-2xl font-black text-blue-600">{fiberRatio.soluble.toFixed(1)}g</div>
                      </div>
                      <div className="rounded-2xl bg-orange-50 p-4 border border-orange-100">
                        <div className="text-[10px] font-black uppercase tracking-widest text-orange-700">Insoluble</div>
                        <div className="text-2xl font-black text-orange-600">{fiberRatio.insoluble.toFixed(1)}g</div>
                      </div>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden bg-gray-100">
                      <div className="h-full bg-blue-500" style={{ width: `${fiberRatio.soluble + fiberRatio.insoluble > 0 ? (fiberRatio.soluble / (fiberRatio.soluble + fiberRatio.insoluble)) * 100 : 0}%` }} />
                    </div>
                    <p className="text-xs text-subtle">Based on foods with explicit soluble/insoluble fiber data.</p>
                  </>
                ) : (
                  <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-100 p-4">
                    <TriangleAlert size={18} className="text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-900">Fiber split unavailable for some foods in this range, so the ratio is hidden instead of estimated.</p>
                  </div>
                )}
              </div>
            </ChartContainer>

            <ChartContainer title="Top Fiber Contributors" subtitle="Foods contributing the most fiber">
              {topFiberContributors.length > 0 ? (
                <div className="space-y-4">
                  {topFiberContributors.slice(0, 5).map((item, index) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-xs font-black text-green-700">{index + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-3 mb-1">
                          <span className="text-sm font-bold truncate">{item.name}</span>
                          <span className="text-xs font-mono text-subtle">{item.value.toFixed(1)}g</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${(item.value / (topFiberContributors[0]?.value || 1)) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No fiber contributors in this period." />
              )}
            </ChartContainer>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ChartContainer title="Low-Fiber Days" subtitle="Days below the 35g goal">
              {lowFiberDays.length > 0 ? (
                <div className="space-y-3">
                  {lowFiberDays.map(day => (
                    <div key={day.date}>
                      <InsightRow label={format(parseLocalDateInput(day.date) || new Date(), 'MMM d, yyyy')} value={`${day.metrics.fiber.toFixed(1)}g fiber`} tone="amber" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No low-fiber days in the selected range." />
              )}
            </ChartContainer>

            <ChartContainer title="Missing Data" subtitle="Days with no meals logged">
              {missingDataDays.length > 0 ? (
                <div className="space-y-3">
                  {missingDataDays.map(day => (
                    <div key={day.date}>
                      <InsightRow label={format(parseLocalDateInput(day.date) || new Date(), 'MMM d, yyyy')} value="No meals logged" tone="gray" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No completely empty days in this range." />
              )}
            </ChartContainer>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ChartContainer title="Weight Progress" subtitle="Body weight and 7-day moving average">
              {weightChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={weightChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={(val) => format(parseLocalDateInput(val) || new Date(), 'MMM d')} dy={10} />
                    <YAxis axisLine={false} tickLine={false} domain={['dataMin - 1', 'dataMax + 1']} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={(val) => Number(val).toFixed(1)} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{ stroke: '#8b5cf6', strokeWidth: 2 }} labelFormatter={(val) => format(parseLocalDateInput(val) || new Date(), 'MMMM d, yyyy')} />
                    <Line type="monotone" dataKey="weight" stroke="#8b5cf6" strokeWidth={2} strokeOpacity={0.3} dot={{ r: 3, fill: '#8b5cf6', strokeWidth: 1, stroke: '#fff', fillOpacity: 0.5 }} activeDot={{ r: 4, strokeWidth: 0 }} name="Weight" />
                    <Line type="monotone" dataKey="movingAverage" stroke="#8b5cf6" strokeWidth={4} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} name="7-Day Avg" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="Log at least 3 weight entries to see a trend." />
              )}
            </ChartContainer>

            <ChartContainer title="Fiber by Meal" subtitle="Meals contributing the most fiber">
              {topMeals.length > 0 ? (
                <div className="space-y-4">
                  {topMeals.slice(0, 5).map((meal, index) => (
                    <div key={meal.name}>
                      <InsightRow label={`${index + 1}. ${meal.name}`} value={`${meal.fiber.toFixed(1)}g`} tone="green" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No meal-level fiber data in this range." />
              )}
            </ChartContainer>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatSummaryCard label="Protein Avg" value={currentStats.aggregates.avgProtein ? currentStats.aggregates.avgProtein.toFixed(1) : '—'} unit="g" icon={<Award size={20} />} color="bg-blue-50 text-blue-600" />
            <StatSummaryCard label="Calories Avg" value={currentStats.aggregates.avgCalories ? Math.round(currentStats.aggregates.avgCalories).toString() : '—'} unit="kcal" icon={<Flame size={20} />} color="bg-orange-50 text-orange-600" />
            <StatSummaryCard label="Fiber Goal Hits" value={`${currentStats.aggregates.consistencyScore}%`} unit="" icon={<CalendarDays size={20} />} color="bg-emerald-50 text-emerald-700" />
            <StatSummaryCard label="Vegetable Diversity" value={`${currentStats.aggregates.vegDiversity}`} unit="foods" icon={<Droplets size={20} />} color="bg-green-50 text-green-600" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ChartContainer title="Vegetable Analytics" subtitle="Conservative vegetable classification only">
              {vegetableStats.length > 0 ? (
                <div className="space-y-3">
                  {vegetableStats.map((veg, index) => (
                    <div key={veg.name}>
                      <InsightRow label={`${index + 1}. ${veg.name}`} value={`${veg.grams.toFixed(0)}g`} tone="green" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="No conservatively classified vegetables in this period." />
              )}
            </ChartContainer>

            <ChartContainer title="Period Summary" subtitle="Useful context for the selected range">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SummaryPill label="Total meals" value={currentStats.aggregates.totalMeals.toString()} />
                <SummaryPill label="Logged days" value={currentStats.aggregates.loggedDays.toString()} />
                <SummaryPill label="Coverage" value={`${currentStats.aggregates.coveragePercent}%`} />
                <SummaryPill label="Avg fiber / day" value={`${currentStats.aggregates.avgFiber.toFixed(1)}g`} />
              </div>
            </ChartContainer>
          </div>
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

function ComparisonChip({ label, delta, percent, positiveIsGood }: { label: string; delta: number; percent: number | 'n/a'; positiveIsGood: boolean; }) {
  const isPositive = delta > 0;
  const isGood = positiveIsGood ? isPositive : !isPositive;
  const tone = isGood ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100';
  const percentLabel = typeof percent === 'number' ? `${percent > 0 ? '+' : ''}${percent}%` : 'n/a';
  return (
    <div className={cn("rounded-2xl border p-4 flex items-center justify-between gap-3", tone)}>
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest opacity-70">{label} vs prev period</div>
        <div className="text-lg font-black">
          {delta > 0 ? '+' : ''}{delta.toFixed(1)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">Change</div>
        <div className="text-sm font-black">{percentLabel}</div>
      </div>
    </div>
  );
}

function InsightRow({ label, value, tone }: { label: string; value: string; tone: 'green' | 'amber' | 'gray'; }) {
  const colors = {
    green: 'bg-green-50 text-green-700 border-green-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    gray: 'bg-gray-50 text-gray-700 border-gray-100',
  }[tone];
  return (
    <div className={cn("rounded-2xl border px-4 py-3 flex items-center justify-between gap-4", colors)}>
      <span className="text-sm font-semibold truncate">{label}</span>
      <span className="text-sm font-black whitespace-nowrap">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-gray-50 p-6 text-sm text-subtle italic">
      {text}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-gray-50 p-4">
      <div className="text-[10px] font-black uppercase tracking-widest text-subtle mb-1">{label}</div>
      <div className="text-xl font-black text-ink">{value}</div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { Meal, Food } from '../types';
import { cn } from '../lib/utils';
import { Loader2, Scale, Flame, Droplets, Wheat, CalendarDays, Award } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useWeightLogs } from '../lib/queries/weightQueries';
import {
  computeStats,
  getStatisticsPeriodRange,
  type StatisticsPeriodId,
} from '../lib/statsUtils';
import { mapMealRecord } from '../lib/mealItemUtils';
import { getFoodOrUnknown } from '../lib/utils';
import { normalizeDateToLocal, parseLocalDateInput } from '../lib/dateUtils';

interface StatisticsViewProps {
  userId: string;
  meals: Meal[];
  foods: Food[];
  days: 7 | 30 | 90 | 3650;
  setDays: (days: 7 | 30 | 90 | 3650) => void;
  isLoading: boolean;
}

type StatsTab = 'overview' | 'fiber' | 'macros' | 'weight';
type DailyChartMetric = 'fiber' | 'calories' | 'protein' | 'carbs' | 'fat' | 'sugar' | 'saturatedFat';
type FiberRatio = { soluble: number; insoluble: number; unknown: number; isVisible: boolean };
type MetricTone = 'orange' | 'green' | 'blue' | 'amber' | 'gray' | 'neutral';

type FiberCompositionModel = {
  total: number;
  soluble: number;
  insoluble: number;
  unknown: number;
  knownPercent: number | null;
  isReliableSplit: boolean;
};

type TopFiberContributor = {
  name: string;
  grams: number;
  fiber: number;
  calories: number;
  fiberPer100kcal: number | null;
};

const DAILY_CHART_OPTIONS: DailyChartMetric[] = ['fiber', 'calories', 'protein', 'carbs', 'fat', 'sugar', 'saturatedFat'];

const DAILY_CHART_METRICS: Record<
  DailyChartMetric,
  {
    label: string;
    subtitle: string;
    emptyState: string;
    barFill: string;
    formatter: (value: number) => string;
  }
> = {
  fiber: {
    label: 'Fiber',
    subtitle: 'Daily total fiber by local calendar day',
    emptyState: 'No fiber data for this period.',
    barFill: '#22c55e',
    formatter: formatDecimal,
  },
  calories: {
    label: 'Calories',
    subtitle: 'Daily calories by local calendar day',
    emptyState: 'No calorie data for this period.',
    barFill: '#f97316',
    formatter: formatCalories,
  },
  protein: {
    label: 'Protein',
    subtitle: 'Daily protein by local calendar day',
    emptyState: 'No protein data for this period.',
    barFill: '#3b82f6',
    formatter: formatDecimal,
  },
  carbs: {
    label: 'Carbs',
    subtitle: 'Daily carbs by local calendar day',
    emptyState: 'No carb data for this period.',
    barFill: '#f59e0b',
    formatter: formatDecimal,
  },
  fat: {
    label: 'Fat',
    subtitle: 'Daily fat by local calendar day',
    emptyState: 'No fat data for this period.',
    barFill: '#6b7280',
    formatter: formatDecimal,
  },
  sugar: {
    label: 'Sugar',
    subtitle: 'Daily sugar by local calendar day',
    emptyState: 'No sugar data for this period.',
    barFill: '#ec4899',
    formatter: formatDecimal,
  },
  saturatedFat: {
    label: 'Saturated fat',
    subtitle: 'Daily saturated fat by local calendar day',
    emptyState: 'No saturated fat data for this period.',
    barFill: '#64748b',
    formatter: formatDecimal,
  },
};

const PERIOD_OPTIONS: { id: StatisticsPeriodId; label: string }[] = [
  { id: 'this_week', label: 'This Week' },
  { id: 'last_week', label: 'Last Week' },
  { id: 'last_7_days', label: 'Last 7 Days' },
  { id: 'last_30_days', label: 'Last 30 Days' },
  { id: 'last_90_days', label: 'Last 90 Days' },
  { id: 'all_time', label: 'All Time' },
  { id: 'custom_range', label: 'Custom Range' },
];

const TABS: { id: StatsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'fiber', label: 'Fiber' },
  { id: 'macros', label: 'Macros' },
  { id: 'weight', label: 'Weight' },
];

export default function StatisticsView({ userId, meals, foods, days, setDays, isLoading }: StatisticsViewProps) {
  const [activeTab, setActiveTab] = useState<StatsTab>('overview');
  const [dailyChartMetric, setDailyChartMetric] = useState<DailyChartMetric>('fiber');
  const [selectedPeriod, setSelectedPeriod] = useState<StatisticsPeriodId>(() => mapDaysToPeriod(days));
  const [customStart, setCustomStart] = useState(() => format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [isTopFiberModalOpen, setIsTopFiberModalOpen] = useState(false);
  const [allMeals, setAllMeals] = useState<Meal[]>(meals);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const { data: weightLogs = [] } = useWeightLogs(userId);

  React.useEffect(() => {
    let cancelled = false;

    async function fetchStatsMeals() {
      setIsStatsLoading(true);

      const { data, error } = await supabase
        .from('meals')
        .select(`
          *,
          meal_items (*)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('Error fetching statistics meals:', error);
        setAllMeals(meals);
      } else if (data) {
        setAllMeals(data.map((meal: any) => mapMealRecord(meal)));
      }

      setIsStatsLoading(false);
    }

    fetchStatsMeals();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const selectedRange = useMemo(
    () => getStatisticsPeriodRange(selectedPeriod, allMeals, { customStart, customEnd }),
    [selectedPeriod, allMeals, customStart, customEnd]
  );

  const periodMeals = useMemo(() => {
    return allMeals.filter(meal => {
      const dateKey = normalizeDateToLocal(meal.created_at);
      if (!dateKey) return false;
      return dateKey >= selectedRange.start && dateKey <= selectedRange.end;
    });
  }, [allMeals, selectedRange.start, selectedRange.end]);

  const stats = useMemo(() => {
    return computeStats(periodMeals, foods, selectedRange.start, selectedRange.end);
  }, [periodMeals, foods, selectedRange.start, selectedRange.end]);

  const weightLogsInPeriod = useMemo(() => {
    return weightLogs
      .filter(log => {
        const dateKey = normalizeDateToLocal(log.date);
        if (!dateKey) return false;
        return dateKey >= selectedRange.start && dateKey <= selectedRange.end;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [weightLogs, selectedRange.start, selectedRange.end]);

  const dailyFiberData = useMemo(() => {
    return stats.calendarDailyData.map(day => ({
      date: day.date,
      totalFiber: Number(day.metrics.fiber.toFixed(1)),
      solubleFiber: Number(day.metrics.solubleFiber.toFixed(1)),
      insolubleFiber: Number(day.metrics.insolubleFiber.toFixed(1)),
      unknownFiber: Number(day.metrics.unknownFiber.toFixed(1)),
      calories: Number(day.metrics.calories.toFixed(0)),
      protein: Number(day.metrics.protein.toFixed(1)),
      carbs: Number(day.metrics.carbs.toFixed(1)),
      fat: Number(day.metrics.fat.toFixed(1)),
      sugar: Number(day.metrics.sugar.toFixed(1)),
      saturatedFat: Number(day.metrics.saturatedFat.toFixed(1)),
      hasMeals: day.hasMeals,
    }));
  }, [stats.calendarDailyData]);

  const weightCaloriesData = useMemo(() => {
    const weightByDate = new Map(
      weightLogsInPeriod.map(log => [normalizeDateToLocal(log.date), Number(log.weight.toFixed(1))] as const)
    );

    return stats.calendarDailyData.map(day => {
      const weight = weightByDate.get(day.date);

      return {
        date: day.date,
        calories: Number(day.metrics.calories.toFixed(0)),
        weight: weight ?? null,
        hasMeals: day.hasMeals,
      };
    });
  }, [stats.calendarDailyData, weightLogsInPeriod]);

  const weightCaloriesObservationCount = useMemo(() => {
    return weightCaloriesData.filter(point => point.weight !== null && point.hasMeals).length;
  }, [weightCaloriesData]);

  const macroDailyData = useMemo(() => {
    return stats.calendarDailyData.map(day => ({
      date: day.date,
      calories: Number(day.metrics.calories.toFixed(0)),
      protein: Number(day.metrics.protein.toFixed(1)),
      carbs: Number(day.metrics.carbs.toFixed(1)),
      fat: Number(day.metrics.fat.toFixed(1)),
      sugar: Number(day.metrics.sugar.toFixed(1)),
      saturatedFat: Number(day.metrics.saturatedFat.toFixed(1)),
      fiber: Number(day.metrics.fiber.toFixed(1)),
      hasMeals: day.hasMeals,
    }));
  }, [stats.calendarDailyData]);

  const topFiberContributors = useMemo(() => {
    const contributors = new Map<string, TopFiberContributor & { count: number }>();

    periodMeals.forEach(meal => {
      (meal.items || []).forEach(item => {
        const factor = item.quantityGrams / 100;
        const isCustom = !!item.is_custom;
        const food = !isCustom && item.foodId ? getFoodOrUnknown(foods, item.foodId) : null;

        if (!isCustom && (!food || food.id === 'unknown')) {
          return;
        }

        const name = isCustom
          ? (item.name || 'Manual item')
          : (food?.name_hu || food?.name_en || 'Unknown');
        const key = isCustom
          ? `custom:${name}:${item.calories ?? 0}:${item.protein ?? 0}:${item.carbs ?? 0}:${item.fat ?? 0}:${item.sugar ?? 0}:${item.saturated_fat ?? 0}:${item.total_fiber ?? item.fiber ?? 0}:${item.soluble_fiber ?? 0}:${item.insoluble_fiber ?? 0}:${item.gi ?? 'n/a'}`
          : `food:${food?.id}`;
        const current = contributors.get(key) ?? {
          name,
          grams: 0,
          fiber: 0,
          calories: 0,
          fiberPer100kcal: null,
          count: 0,
        };

        const itemFiber = isCustom
          ? ((item.total_fiber ?? item.fiber ?? 0) * factor)
          : ((food?.total_fiber ?? 0) * factor);
        const itemCalories = isCustom
          ? ((item.calories ?? 0) * factor)
          : ((food?.calories ?? 0) * factor);

        current.grams += item.quantityGrams;
        current.fiber += itemFiber;
        current.calories += itemCalories;
        current.count += 1;
        contributors.set(key, current);
      });
    });

    return Array.from(contributors.values())
      .map(({ count: _count, ...item }) => ({
        ...item,
        grams: Number(item.grams.toFixed(0)),
        fiber: Number(item.fiber.toFixed(1)),
        calories: Math.round(item.calories),
        fiberPer100kcal: item.calories > 0 ? Number(((item.fiber / item.calories) * 100).toFixed(1)) : null,
      }))
      .filter(item => item.fiber > 0)
      .sort((a, b) => b.fiber - a.fiber)
      .slice(0, 20);
  }, [foods, periodMeals]);

  const hasWeightData = weightCaloriesObservationCount >= 2;
  const weightChange = hasWeightData
    ? weightLogsInPeriod[weightLogsInPeriod.length - 1].weight - weightLogsInPeriod[0].weight
    : null;
  const fiberComposition = buildFiberCompositionModel(stats.aggregates.fiberRatio);
  const hasFiberSplitDailyData = stats.aggregates.fiberRatio?.isVisible ?? false;
  const topFiberContributorsPreview = topFiberContributors.slice(0, 5);

  if (isLoading || isStatsLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Loader2 className="animate-spin text-accent mb-4" size={48} />
        <p className="text-subtle font-medium">Analyzing your data...</p>
      </div>
    );
  }

  const selectedLabel = selectedRange.label;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-3xl font-[800] tracking-tight">Statistics</h2>
            <p className="text-subtle text-sm">
              {selectedLabel} analytics from {selectedRange.start} to {selectedRange.end}
            </p>
          </div>

          <div className="space-y-3 xl:max-w-4xl">
            <div className="flex flex-wrap gap-2 rounded-[1.25rem] border border-border bg-white p-2 shadow-sm">
              {PERIOD_OPTIONS.map(option => (
                <button
                  key={option.id}
                  onClick={() => handlePeriodChange(option.id, setSelectedPeriod, setDays)}
                  className={cn(
                    'rounded-xl px-4 py-2 text-sm font-bold transition-all',
                    selectedPeriod === option.id
                      ? 'bg-ink text-white shadow-sm'
                      : 'bg-gray-50 text-subtle hover:text-ink hover:bg-gray-100'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {selectedPeriod === 'custom_range' && (
              <div className="grid grid-cols-1 gap-3 rounded-[1.25rem] border border-border bg-white p-4 shadow-sm sm:grid-cols-2">
                <DateField
                  label="Start date"
                  value={customStart}
                  onChange={setCustomStart}
                />
                <DateField
                  label="End date"
                  value={customEnd}
                  onChange={setCustomEnd}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 rounded-[1.25rem] border border-border bg-white p-2 shadow-sm">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-xl px-4 py-2 text-sm font-bold transition-all',
                activeTab === tab.id
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-gray-50 text-subtle hover:text-ink hover:bg-gray-100'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Avg calories" value={Math.round(stats.aggregates.avgCalories).toString()} unit="kcal" icon={<Flame size={20} />} tone="orange" />
            <MetricCard label="Avg total fiber" value={formatDecimal(stats.aggregates.avgFiber)} unit="g" icon={<Wheat size={20} />} tone="green" />
            <MetricCard label="Avg soluble fiber" value={formatDecimal(stats.aggregates.avgSolubleFiber)} unit="g" icon={<Droplets size={20} />} tone="blue" />
            <MetricCard label="Avg insoluble fiber" value={formatDecimal(stats.aggregates.avgInsolubleFiber)} unit="g" icon={<Wheat size={20} />} tone="amber" />
            <MetricCard label="Avg protein" value={formatDecimal(stats.aggregates.avgProtein)} unit="g" icon={<Award size={20} />} tone="blue" />
            <MetricCard label="Avg carbs" value={formatDecimal(stats.aggregates.avgCarbs)} unit="g" icon={<Wheat size={20} />} tone="orange" />
            <MetricCard label="Avg fat" value={formatDecimal(stats.aggregates.avgFat)} unit="g" icon={<Flame size={20} />} tone="gray" />
            <MetricCard label="Avg sugar" value={formatDecimal(stats.aggregates.avgSugar)} unit="g" icon={<Award size={20} />} tone="neutral" />
            <MetricCard label="Avg saturated fat" value={formatDecimal(stats.aggregates.avgSaturatedFat)} unit="g" icon={<Flame size={20} />} tone="neutral" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <DailyChartPanel
              data={dailyFiberData}
              selectedMetric={dailyChartMetric}
              onMetricChange={setDailyChartMetric}
              hasFiberSplitData={hasFiberSplitDailyData}
            />

            <FiberCompositionPanel composition={fiberComposition} />
          </div>

          <Panel
            title="Top fiber contributors"
            subtitle="Logged meal items ranked by total fiber contribution"
            actions={
              topFiberContributors.length > topFiberContributorsPreview.length ? (
                <button
                  type="button"
                  onClick={() => setIsTopFiberModalOpen(true)}
                  className="rounded-xl bg-gray-50 px-3 py-2 text-xs font-bold text-subtle transition-all hover:bg-gray-100 hover:text-ink"
                >
                  View all
                </button>
              ) : null
            }
          >
            {topFiberContributorsPreview.length > 0 ? (
              <div className="overflow-hidden rounded-3xl border border-border">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-subtle">
                      <th className="px-4 py-3">Food</th>
                      <th className="px-4 py-3 text-right">Consumed grams</th>
                      <th className="px-4 py-3 text-right">Fiber</th>
                      <th className="px-4 py-3 text-right">Calories</th>
                      <th className="px-4 py-3 text-right">Fiber / 100 kcal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {topFiberContributorsPreview.map((item, index) => (
                      <tr key={`${item.name}-${index}`} className="text-sm">
                        <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">{Math.round(item.grams)} g</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">{formatDecimal(item.fiber)} g</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">{item.calories} kcal</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">
                          {item.fiberPer100kcal === null ? '—' : `${formatDecimal(item.fiberPer100kcal)} g`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="No fiber contributors in this period." />
            )}
          </Panel>

          <Panel title="Macro overview" subtitle="Daily calorie and macro trends plus logged-day averages for the selected period">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Panel title="Daily calories" subtitle="Local calendar-day totals">
                {macroDailyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={macroDailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#94a3b8' }}
                        tickFormatter={formatShortDate}
                        dy={10}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number) => [formatCalories(Number(value)), 'Calories']}
                        labelFormatter={(label) => formatLongDate(String(label))}
                      />
                      <Line type="monotone" dataKey="calories" stroke="#f97316" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState text="No calorie data for this period." />
                )}
              </Panel>

            <Panel title="Daily macro distribution" subtitle="Protein, carbs, fat, sugar, and saturated fat by day">
              {macroDailyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={macroDailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#94a3b8' }}
                        tickFormatter={formatShortDate}
                        dy={10}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number, name) => [formatDecimal(Number(value)), mealSeriesLabel(String(name))]}
                        labelFormatter={(label) => formatLongDate(String(label))}
                      />
                    <Legend />
                    <Bar dataKey="protein" stackId="macros" fill="#3b82f6" name="Protein" />
                    <Bar dataKey="carbs" stackId="macros" fill="#f59e0b" name="Carbs" />
                    <Bar dataKey="fat" stackId="macros" fill="#6b7280" name="Fat" />
                    <Bar dataKey="sugar" stackId="macros" fill="#ec4899" name="Sugar" />
                    <Bar dataKey="saturatedFat" stackId="macros" fill="#64748b" name="Saturated fat" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No macro data for this period." />
              )}
            </Panel>
          </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 mt-6">
              <PillMetric label="Avg calories / logged day" value={formatCalories(stats.aggregates.avgCalories)} tone="orange" />
              <PillMetric label="Avg protein / logged day" value={`${formatDecimal(stats.aggregates.avgProtein)} g`} tone="blue" />
              <PillMetric label="Avg carbs / logged day" value={`${formatDecimal(stats.aggregates.avgCarbs)} g`} tone="amber" />
              <PillMetric label="Avg fat / logged day" value={`${formatDecimal(stats.aggregates.avgFat)} g`} tone="gray" />
              <PillMetric label="Avg sugar / logged day" value={`${formatDecimal(stats.aggregates.avgSugar)} g`} tone="gray" />
              <PillMetric label="Avg saturated fat / logged day" value={`${formatDecimal(stats.aggregates.avgSaturatedFat)} g`} tone="gray" />
            </div>
          </Panel>

          {hasWeightData ? (
            <Panel title="Weight vs calories" subtitle="Daily calories and weight plotted by local date">
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={weightCaloriesData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    tickFormatter={formatShortDate}
                    dy={10}
                  />
                  <YAxis
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    tickFormatter={(value) => formatCalories(Number(value))}
                    label={{ value: 'Calories', angle: -90, position: 'insideLeft', dx: 10 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    tickFormatter={(value) => `${Number(value).toFixed(1)} kg`}
                    label={{ value: 'Weight', angle: 90, position: 'insideRight', dx: -10 }}
                  />
                  <Tooltip content={<WeightCaloriesTooltip />} />
                  <Bar yAxisId="left" dataKey="calories" fill="#f97316" name="Calories" radius={[8, 8, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="weight"
                    name="Weight"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-white p-6 text-sm text-subtle shadow-sm">
              Not enough same-period calories and weight observations to build the combined chart. At least two days with both metrics are needed.
            </div>
          )}
        </section>
      )}

      {activeTab === 'fiber' && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <DailyChartPanel
              data={dailyFiberData}
              selectedMetric={dailyChartMetric}
              onMetricChange={setDailyChartMetric}
              hasFiberSplitData={hasFiberSplitDailyData}
            />

            <FiberCompositionPanel composition={fiberComposition} />
          </div>
        </section>
      )}

      {activeTab === 'macros' && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Daily calories" subtitle="Local calendar-day totals">
              {macroDailyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={macroDailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      tickFormatter={formatShortDate}
                      dy={10}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number) => [formatCalories(Number(value)), 'Calories']}
                      labelFormatter={(label) => formatLongDate(String(label))}
                    />
                    <Line type="monotone" dataKey="calories" stroke="#f97316" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No calorie data for this period." />
              )}
            </Panel>

            <Panel title="Daily macro distribution" subtitle="Protein, carbs, fat, sugar, and saturated fat by day">
              {macroDailyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={macroDailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      tickFormatter={formatShortDate}
                      dy={10}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name) => [formatDecimal(Number(value)), mealSeriesLabel(String(name))]}
                      labelFormatter={(label) => formatLongDate(String(label))}
                    />
                    <Legend />
                    <Bar dataKey="protein" stackId="macros" fill="#3b82f6" name="Protein" />
                    <Bar dataKey="carbs" stackId="macros" fill="#f59e0b" name="Carbs" />
                    <Bar dataKey="fat" stackId="macros" fill="#6b7280" name="Fat" />
                    <Bar dataKey="sugar" stackId="macros" fill="#ec4899" name="Sugar" />
                    <Bar dataKey="saturatedFat" stackId="macros" fill="#64748b" name="Saturated fat" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No macro data for this period." />
              )}
            </Panel>
          </div>

          <Panel title="Period macro summary" subtitle="Totals for the selected period">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <PillMetric label="Avg calories / logged day" value={formatCalories(stats.aggregates.avgCalories)} tone="orange" />
              <PillMetric label="Avg protein / logged day" value={`${formatDecimal(stats.aggregates.avgProtein)} g`} tone="blue" />
              <PillMetric label="Avg carbs / logged day" value={`${formatDecimal(stats.aggregates.avgCarbs)} g`} tone="amber" />
              <PillMetric label="Avg fat / logged day" value={`${formatDecimal(stats.aggregates.avgFat)} g`} tone="gray" />
              <PillMetric label="Avg sugar / logged day" value={`${formatDecimal(stats.aggregates.avgSugar)} g`} tone="gray" />
              <PillMetric label="Avg saturated fat / logged day" value={`${formatDecimal(stats.aggregates.avgSaturatedFat)} g`} tone="gray" />
            </div>
          </Panel>
        </section>
      )}

      {activeTab === 'weight' && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Weight entries in period" value={weightLogsInPeriod.length.toString()} unit="" icon={<Scale size={20} />} tone="neutral" />
            <MetricCard label="Nutrition logged days" value={stats.aggregates.loggedDays.toString()} unit="" icon={<CalendarDays size={20} />} tone="green" />
            <MetricCard label="Avg calories / logged day" value={Math.round(stats.aggregates.avgCalories).toString()} unit="kcal" icon={<Flame size={20} />} tone="orange" />
            <MetricCard label="Avg fiber / logged day" value={formatDecimal(stats.aggregates.avgFiber)} unit="g" icon={<Wheat size={20} />} tone="green" />
            <MetricCard
              label="Weight change"
              value={weightChange === null ? '—' : `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)}`}
              unit={weightChange === null ? '' : 'kg'}
              icon={<Scale size={20} />}
              tone={weightChange === null ? 'neutral' : weightChange > 0 ? 'orange' : 'green'}
            />
          </div>

          {!hasWeightData ? (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-white p-6 text-sm text-subtle shadow-sm">
              Not enough same-period calories and weight observations to build the combined chart. At least two days with both metrics are needed.
            </div>
          ) : (
            <Panel title="Weight vs calories" subtitle="Daily calories and weight plotted by local date">
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={weightCaloriesData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    tickFormatter={formatShortDate}
                    dy={10}
                  />
                  <YAxis
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    tickFormatter={(value) => formatCalories(Number(value))}
                    label={{ value: 'Calories', angle: -90, position: 'insideLeft', dx: 10 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    tickFormatter={(value) => `${Number(value).toFixed(1)} kg`}
                    label={{ value: 'Weight', angle: 90, position: 'insideRight', dx: -10 }}
                  />
                  <Tooltip content={<WeightCaloriesTooltip />} />
                  <Bar yAxisId="left" dataKey="calories" fill="#f97316" name="Calories" radius={[8, 8, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="weight"
                    name="Weight"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          )}
        </section>
      )}

      {isTopFiberModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-[2rem] border border-border bg-white p-6 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-[800] tracking-tight">All fiber contributors</h3>
                <p className="text-xs font-medium text-subtle">All logged meal items in the selected period</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTopFiberModalOpen(false)}
                className="rounded-xl bg-gray-50 px-3 py-2 text-xs font-bold text-subtle transition-all hover:bg-gray-100 hover:text-ink"
              >
                Close
              </button>
            </div>

            {topFiberContributors.length > 0 ? (
              <div className="overflow-auto rounded-3xl border border-border">
                <table className="min-w-full divide-y divide-border">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-subtle">
                      <th className="px-4 py-3">Food</th>
                      <th className="px-4 py-3 text-right">Consumed grams</th>
                      <th className="px-4 py-3 text-right">Fiber</th>
                      <th className="px-4 py-3 text-right">Calories</th>
                      <th className="px-4 py-3 text-right">Fiber / 100 kcal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {topFiberContributors.map((item, index) => (
                      <tr key={`${item.name}-${index}`} className="text-sm">
                        <td className="px-4 py-3 font-semibold text-ink">{item.name}</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">{Math.round(item.grams)} g</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">{formatDecimal(item.fiber)} g</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">{item.calories} kcal</td>
                        <td className="px-4 py-3 text-right font-mono text-subtle">
                          {item.fiberPer100kcal === null ? '—' : `${formatDecimal(item.fiberPer100kcal)} g`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="No fiber contributors in this period." />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function handlePeriodChange(
  period: StatisticsPeriodId,
  setSelectedPeriod: React.Dispatch<React.SetStateAction<StatisticsPeriodId>>,
  setDays: (days: 7 | 30 | 90 | 3650) => void
) {
  setSelectedPeriod(period);

  if (period === 'last_30_days') {
    setDays(30);
    return;
  }

  if (period === 'last_90_days') {
    setDays(90);
    return;
  }

  if (period === 'all_time' || period === 'custom_range') {
    setDays(3650);
    return;
  }

  setDays(7);
}

function mapDaysToPeriod(days: 7 | 30 | 90 | 3650): StatisticsPeriodId {
  if (days === 30) return 'last_30_days';
  if (days === 90) return 'last_90_days';
  if (days === 3650) return 'all_time';
  return 'this_week';
}

function formatShortDate(value: string): string {
  return format(parseLocalDateInput(value) || new Date(), 'MMM d');
}

function formatLongDate(value: string): string {
  return format(parseLocalDateInput(value) || new Date(), 'MMMM d, yyyy');
}

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function formatCalories(value: number): string {
  return `${Math.round(value)} kcal`;
}

function dailySeriesLabel(name: string): string {
  if (name === 'solubleFiber') return 'Soluble fiber';
  if (name === 'insolubleFiber') return 'Insoluble fiber';
  if (name === 'unknownFiber') return 'Unknown split';
  if (name === 'totalFiber') return 'Total fiber';
  if (name === 'fiber') return 'Fiber';
  if (name === 'calories') return 'Calories';
  if (name === 'protein') return 'Protein';
  if (name === 'carbs') return 'Carbs';
  if (name === 'fat') return 'Fat';
  if (name === 'sugar') return 'Sugar';
  if (name === 'saturatedFat') return 'Saturated fat';
  return name;
}

function mealSeriesLabel(name: string): string {
  if (name === 'protein') return 'Protein';
  if (name === 'carbs') return 'Carbs';
  if (name === 'fat') return 'Fat';
  if (name === 'fiber') return 'Fiber';
  if (name === 'calories') return 'Calories';
  if (name === 'sugar') return 'Sugar';
  if (name === 'saturatedFat') return 'Saturated fat';
  return name;
}

function buildFiberCompositionModel(fiberRatio: FiberRatio | null): FiberCompositionModel {
  const total = fiberRatio ? fiberRatio.soluble + fiberRatio.insoluble + fiberRatio.unknown : 0;
  const known = fiberRatio ? fiberRatio.soluble + fiberRatio.insoluble : 0;
  const isReliableSplit = !!fiberRatio?.isVisible && total > 0;

  return {
    total,
    soluble: fiberRatio?.soluble ?? 0,
    insoluble: fiberRatio?.insoluble ?? 0,
    unknown: fiberRatio?.unknown ?? 0,
    knownPercent: isReliableSplit ? (known / total) * 100 : null,
    isReliableSplit,
  };
}

function DailyChartPanel({
  data,
  selectedMetric,
  onMetricChange,
  hasFiberSplitData,
}: {
  data: Array<{
    date: string;
    totalFiber: number;
    solubleFiber: number;
    insolubleFiber: number;
    unknownFiber: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    sugar: number;
    saturatedFat: number;
  }>;
  selectedMetric: DailyChartMetric;
  onMetricChange: (metric: DailyChartMetric) => void;
  hasFiberSplitData: boolean;
}) {
  const activeMetric = DAILY_CHART_METRICS[selectedMetric];
  const showFiberSplit = selectedMetric === 'fiber' && hasFiberSplitData;
  const chartHeight = 320;

  const getMetricValue = (point: {
    totalFiber: number;
    solubleFiber: number;
    insolubleFiber: number;
    unknownFiber: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    sugar: number;
    saturatedFat: number;
  }, metric: DailyChartMetric) => {
    if (metric === 'fiber') return point.totalFiber;
    if (metric === 'calories') return point.calories;
    if (metric === 'protein') return point.protein;
    if (metric === 'carbs') return point.carbs;
    if (metric === 'fat') return point.fat;
    if (metric === 'sugar') return point.sugar;
    return point.saturatedFat;
  };

  const hasMetricData = selectedMetric === 'fiber'
    ? (showFiberSplit
      ? data.some(point => point.solubleFiber > 0 || point.insolubleFiber > 0)
      : data.some(point => point.totalFiber > 0))
    : data.some(point => getMetricValue(point, selectedMetric) > 0);

  return (
    <Panel title="Daily chart" subtitle={activeMetric.subtitle}>
      <div className="mb-4 flex flex-wrap gap-2 rounded-[1.25rem] border border-border bg-white p-2 shadow-sm">
        {DAILY_CHART_OPTIONS.map(option => {
          const optionConfig = DAILY_CHART_METRICS[option];
          const isActive = selectedMetric === option;

          return (
            <button
              key={option}
              type="button"
              onClick={() => onMetricChange(option)}
              className={cn(
                'rounded-xl px-3 py-2 text-sm font-bold transition-all',
                isActive
                  ? 'bg-ink text-white shadow-sm'
                  : 'bg-gray-50 text-subtle hover:text-ink hover:bg-gray-100'
              )}
            >
              {optionConfig.label}
            </button>
          );
        })}
      </div>

      {hasMetricData ? (
        <>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                tickFormatter={formatShortDate}
                dy={10}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name) => [activeMetric.formatter(Number(value)), dailySeriesLabel(String(name))]}
                labelFormatter={(label) => formatLongDate(String(label))}
              />
              {showFiberSplit ? (
                <>
                  <Legend />
                  <Bar dataKey="solubleFiber" stackId="fiber" fill="#60a5fa" name="Soluble fiber" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="insolubleFiber" stackId="fiber" fill="#f59e0b" name="Insoluble fiber" radius={[8, 8, 0, 0]} />
                </>
              ) : (
                <Bar
                  dataKey={selectedMetric === 'fiber' ? 'totalFiber' : selectedMetric}
                  fill={activeMetric.barFill}
                  name={selectedMetric === 'fiber' ? 'Total fiber' : activeMetric.label}
                  radius={[8, 8, 0, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>

          {selectedMetric === 'fiber' && !hasFiberSplitData && data.some(point => point.totalFiber > 0) ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border bg-gray-50 p-4 text-xs font-medium text-subtle">
              Split data is incomplete for this period, so the chart falls back to total fiber.
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState text={activeMetric.emptyState} />
      )}
    </Panel>
  );
}

function FiberCompositionPanel({
  composition,
}: {
  composition: FiberCompositionModel;
}) {
  const hasTotal = composition.total > 0;
  const isReliable = composition.isReliableSplit && hasTotal;
  const showSoluble = composition.soluble > 0;
  const showInsoluble = composition.insoluble > 0;
  const showUnknown = composition.unknown > 0;

  return (
    <Panel
      title="Fiber composition"
      subtitle={hasTotal ? 'Period-level fiber composition for the selected period' : 'No fiber data for this period'}
    >
      {hasTotal ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-subtle">Total fiber</div>
              <div className="mt-2 text-3xl font-black text-ink">
                {formatDecimal(composition.total)}
                <span className="ml-1 text-sm font-bold text-subtle">g</span>
              </div>
            </div>
            {isReliable && composition.knownPercent !== null ? (
              <PillMetric label="Known split" value={`${formatDecimal(composition.knownPercent)}%`} tone="green" />
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-3 text-xs font-medium text-subtle">
                Split data is incomplete
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
              {isReliable ? (
                <>
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${(composition.soluble / composition.total) * 100}%` }}
                  />
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${(composition.insoluble / composition.total) * 100}%` }}
                  />
                </>
              ) : (
                <div className="h-full w-full bg-slate-400" />
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-[11px] font-medium text-subtle">
              <span>
                {isReliable
                  ? 'Soluble and insoluble split are both reliable for this period.'
                  : 'Only total fiber is reliable for this period. Unknown split is shown separately below.'}
              </span>
              <span>{formatDecimal(composition.total)} g total</span>
            </div>
          </div>

          <div className={cn('grid grid-cols-1 gap-3', [showSoluble, showInsoluble, showUnknown].filter(Boolean).length > 1 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            {showSoluble ? <PillMetric label="Soluble fiber" value={`${formatDecimal(composition.soluble)} g`} tone="blue" /> : null}
            {showInsoluble ? <PillMetric label="Insoluble fiber" value={`${formatDecimal(composition.insoluble)} g`} tone="amber" /> : null}
            {showUnknown ? <PillMetric label="Unknown split" value={`${formatDecimal(composition.unknown)} g`} tone="gray" /> : null}
            {!isReliable ? (
              <div className="rounded-2xl border border-dashed border-border bg-gray-50 p-4 text-sm text-subtle sm:col-span-2">
                Split data is incomplete, so the known split percentage is hidden.
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState text="No fiber data for this period." />
      )}
    </Panel>
  );
}

function MetricCard({
  label,
  value,
  unit,
  icon,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  icon: React.ReactNode;
  tone: MetricTone;
}) {
  const toneStyles: Record<MetricTone, string> = {
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    gray: 'bg-gray-50 text-gray-600',
    neutral: 'bg-white text-ink border border-border',
  };

  return (
    <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm flex items-center gap-4">
      <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', toneStyles[tone])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-black uppercase tracking-widest text-subtle">
          {label}
        </div>
        <div className="mt-1 text-xl font-black text-ink">
          {value}
          {unit ? <span className="ml-1 text-xs font-bold text-subtle">{unit}</span> : null}
        </div>
      </div>
    </div>
  );
}

function PillMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'orange' | 'blue' | 'amber' | 'green' | 'gray';
}) {
  const styles = {
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    gray: 'bg-gray-50 text-gray-700 border-gray-100',
  }[tone];

  return (
    <div className={cn('rounded-2xl border px-4 py-3', styles)}>
      <div className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-border bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-[800] tracking-tight">{title}</h3>
          <p className="text-xs font-medium text-subtle">{subtitle}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-gray-50 p-6 text-sm text-subtle">
      {text}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-subtle">{label}</label>
      <input
        type="date"
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-2xl border border-border bg-gray-50 px-4 py-3 text-sm text-ink outline-none transition-all focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

function WeightCaloriesTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { date?: string; weight?: number | null; calories?: number } }>;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-white p-4 text-sm text-ink" style={tooltipStyle}>
      <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-subtle">
        {point.date ? formatLongDate(point.date) : 'Observation'}
      </div>
      <div className="space-y-1">
        <div className="font-semibold">Calories: {formatCalories(point.calories ?? 0)}</div>
        <div className="font-semibold">
          {point.weight === null || point.weight === undefined ? 'Weight: -' : `Weight: ${point.weight.toFixed(1)} kg`}
        </div>
      </div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  borderRadius: '16px',
  border: 'none',
  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
};

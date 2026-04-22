import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, 
  BarChart, Bar, Cell, Legend
} from 'recharts';
import { format, subDays, parseISO, isSameDay, differenceInDays } from 'date-fns';
import { Meal, Food } from '../types';
import { cn } from '../lib/utils';
import { 
  Loader2, TrendingUp, Download, Calendar, ArrowUpRight, ArrowDownRight, 
  Zap, Activity, Star, AlertTriangle, ChevronDown, Filter, Info
} from 'lucide-react';
import { ProcessedStats } from '../lib/statsUtils';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface StatisticsViewProps {
  stats: ProcessedStats | null;
  isLoading: boolean;
  onRangeChange: (start: string, end: string) => void;
  currentRange: { start: string, end: string };
}

type MetricKey = 'fiber' | 'calories' | 'protein' | 'carbs' | 'fat' | 'gl';

const METRIC_CONFIG: Record<MetricKey, { label: string, unit: string, color: string, group: 'Macros' | 'Other' }> = {
  fiber: { label: 'Fiber', unit: 'g', color: '#10b981', group: 'Other' },
  calories: { label: 'Calories', unit: 'kcal', color: '#f59e0b', group: 'Other' },
  gl: { label: 'Glycemic Load', unit: '', color: '#ef4444', group: 'Other' },
  protein: { label: 'Protein', unit: 'g', color: '#3b82f6', group: 'Macros' },
  carbs: { label: 'Carbohydrates', unit: 'g', color: '#8b5cf6', group: 'Macros' },
  fat: { label: 'Fat', unit: 'g', color: '#ec4899', group: 'Macros' },
};

export default function StatisticsView({ stats, isLoading, onRangeChange, currentRange }: StatisticsViewProps) {
  const [primaryMetric, setPrimaryMetric] = useState<MetricKey>('fiber');
  const [comparisonMetric, setComparisonMetric] = useState<MetricKey | 'none'>('none');
  const [topSourceView, setTopSourceView] = useState<'contribution' | 'frequency'>('contribution');
  const [revealedIndex, setRevealedIndex] = useState(-1);
  const reportRef = useRef<HTMLDivElement>(null);

  // Reset metrics on range change
  useEffect(() => {
    if (stats) {
      setPrimaryMetric('fiber');
      setComparisonMetric('none');
    }
  }, [stats?.range?.start, stats?.range?.end]);

  // Progressive staggered reveal
  useEffect(() => {
    if (stats && !isLoading) {
      setRevealedIndex(-1);
      const sequence = [0, 1, 2, 3]; // KPIs, Trend Control, Chart, Sources
      sequence.forEach((val, i) => {
        setTimeout(() => setRevealedIndex(val), i * 100);
      });
    }
  }, [stats?.range?.start, stats?.range?.end, isLoading]);

  const formatValue = (val: number | undefined | null, key: MetricKey) => {
    if (val === undefined || val === null || isNaN(val)) return '0';
    if (key === 'fiber') return val.toFixed(1);
    return Math.round(val).toString();
  };

  const handleExportPDF = async () => {
    const element = document.getElementById('stats-report-wrapper');
    if (!element) return;

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f8fafc',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      });

      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`fibertrack-analytics-${currentRange.start}-to-${currentRange.end}.pdf`);
    } catch (err) {
      console.error('PDF Export failed:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Loader2 className="animate-spin text-accent mb-4" size={48} />
        <p className="text-subtle font-medium">Analyzing your nutrition...</p>
      </div>
    );
  }

  // Robust Guard: Check for null stats or zero meals
  if (!stats || !stats.aggregates || stats.aggregates.totalMeals === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[500px] text-center px-6 bg-white rounded-[2.5rem] border border-border shadow-sm">
        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-6">
          <Activity size={48} className="text-subtle/20" />
        </div>
        <h3 className="text-2xl font-black mb-2 text-ink">No data in this range</h3>
        <p className="text-subtle text-sm max-w-sm mb-8">
          We couldn't find any meals for the selected dates. Try extending the date range or log your next meal!
        </p>
        <div className="flex gap-3">
          <button 
            onClick={() => onRangeChange(format(subDays(new Date(), 29), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd'))}
            className="px-6 py-3 bg-ink text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all"
          >
            Check Last 30 Days
          </button>
        </div>
      </div>
    );
  }

  // Final Guard Wrap to catch unexpected property access errors during render
  try {
    return (
      <div className="space-y-8 pb-32">
        {/* Header Controls */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <h2 className="text-3xl font-[900] tracking-tight text-ink">Analytics</h2>
            <p className="text-subtle text-sm">Reviewing {currentRange.start} – {currentRange.end}</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-border shadow-sm w-full lg:w-auto">
            <div className="flex items-center gap-2 px-4 border-r border-border shrink-0">
              <Calendar size={16} className="text-ink" />
              <input 
                type="date" 
                value={currentRange.start}
                onChange={e => onRangeChange(e.target.value, currentRange.end)}
                className="border-none bg-transparent text-xs font-bold focus:ring-0 p-0"
              />
              <span className="text-subtle">—</span>
              <input 
                type="date" 
                value={currentRange.end}
                onChange={e => onRangeChange(currentRange.start, e.target.value)}
                className="border-none bg-transparent text-xs font-bold focus:ring-0 p-0"
              />
            </div>
            <div className="flex gap-1">
              <button 
                onClick={() => onRangeChange(format(subDays(new Date(), 6), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd'))}
                className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95", 
                  differenceInDays(parseISO(currentRange.end), parseISO(currentRange.start)) === 6 ? "bg-ink text-white shadow-md" : "text-subtle hover:bg-gray-50"
                )}
              >
                7D
              </button>
              <button 
                onClick={() => onRangeChange(format(subDays(new Date(), 29), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd'))}
                className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95", 
                  differenceInDays(parseISO(currentRange.end), parseISO(currentRange.start)) === 29 ? "bg-ink text-white shadow-md" : "text-subtle hover:bg-gray-50"
                )}
              >
                30D
              </button>
            </div>
            <button 
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95 shadow-lg shadow-accent/20"
            >
              <Download size={14} /> Report
            </button>
          </div>
        </div>

        <div id="stats-report-wrapper" className="space-y-8 p-1">
          {/* Layer 0: KPI Summary */}
          <div className={cn("grid grid-cols-1 md:grid-cols-3 gap-4 transition-all duration-500", revealedIndex < 0 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
             <TrendCard 
               label="Daily Fiber Avg"
               value={`${formatValue(stats.aggregates.avgFiber, 'fiber')}g`}
               comparison={stats.aggregates?.comparisons?.fiberDelta}
               percent={stats.aggregates?.comparisons?.fiberPercent}
               unit="g"
               color="text-green-600"
               bg="bg-green-50"
             />
             <TrendCard 
               label="Daily GL Avg"
               value={formatValue(stats.aggregates.avgGL, 'gl')}
               comparison={stats.aggregates?.comparisons?.glDelta}
               percent={stats.aggregates?.comparisons?.glPercent}
               unit=""
               invertColor
               color="text-red-600"
               bg="bg-red-50"
             />
             <TrendCard 
               label="Daily Calorie Avg"
               value={`${formatValue(stats.aggregates.avgCalories, 'calories')}kcal`}
               comparison={stats.aggregates?.comparisons?.caloriesDelta}
               percent={stats.aggregates?.comparisons?.caloriesPercent}
               unit="kcal"
               invertColor
               color="text-amber-600"
               bg="bg-amber-50"
             />
          </div>

          {/* Layer 1: Trend Control & Chart */}
          <div className={cn("bg-white p-8 rounded-[2.5rem] border border-border shadow-sm transition-all duration-500", revealedIndex < 1 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <div>
                  <h3 className="text-2xl font-black text-ink tracking-tight mb-1">Performance Trend</h3>
                  <p className="text-subtle text-xs font-semibold">Visualize longitudinal patterns and relationships</p>
                </div>

                <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                   <div className="flex-1 md:flex-none">
                      <label className="text-[9px] font-black text-subtle uppercase tracking-widest mb-1.5 block ml-1">Primary Metric</label>
                      <div className="relative group">
                         <select 
                           value={primaryMetric}
                           onChange={(e) => setPrimaryMetric(e.target.value as MetricKey)}
                           className="appearance-none bg-gray-50 border-none rounded-xl px-4 py-2.5 text-xs font-bold text-ink pr-10 focus:ring-2 focus:ring-ink/10 w-full cursor-pointer transition-all hover:bg-gray-100"
                         >
                            <optgroup label="Core Nutrition">
                              <option value="fiber">Fiber Intake</option>
                              <option value="calories">Calories</option>
                              <option value="gl">Glycemic Load</option>
                            </optgroup>
                            <optgroup label="Macronutrients">
                              <option value="protein">Protein</option>
                              <option value="carbs">Carbohydrates</option>
                              <option value="fat">Total Fat</option>
                            </optgroup>
                         </select>
                         <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none group-hover:text-ink transition-colors" />
                      </div>
                   </div>

                   <div className="flex-1 md:flex-none">
                      <label className="text-[9px] font-black text-subtle uppercase tracking-widest mb-1.5 block ml-1">Overlay (Comparison)</label>
                      <div className="relative group">
                         <select 
                           value={comparisonMetric}
                           onChange={(e) => setComparisonMetric(e.target.value as any)}
                           className={cn("appearance-none border-none rounded-xl px-4 py-2.5 text-xs font-bold pr-10 focus:ring-2 focus:ring-ink/10 w-full cursor-pointer transition-all", 
                             comparisonMetric === 'none' ? "bg-gray-50 text-subtle/60 hover:bg-gray-100" : "bg-ink/5 text-ink hover:bg-ink/10"
                           )}
                         >
                            <option value="none">None</option>
                            <optgroup label="Core Nutrition">
                               {primaryMetric !== 'fiber' && <option value="fiber">Fiber</option>}
                               {primaryMetric !== 'calories' && <option value="calories">Calories</option>}
                               {primaryMetric !== 'gl' && <option value="gl">Glycemic Load</option>}
                            </optgroup>
                            <optgroup label="Macronutrients">
                               {primaryMetric !== 'protein' && <option value="protein">Protein</option>}
                               {primaryMetric !== 'carbs' && <option value="carbs">Carbohydrates</option>}
                               {primaryMetric !== 'fat' && <option value="fat">Fat</option>}
                            </optgroup>
                         </select>
                         <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none group-hover:text-ink transition-colors" />
                      </div>
                   </div>
                </div>
             </div>

             <div className="h-[340px] w-full">
                {stats.dailyData && stats.dailyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.dailyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fontSize: 10, fontWeight: 700, fill: '#94a3b8'}}
                        dy={10} 
                      />
                      <YAxis 
                        yAxisId="left"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fontSize: 10, fontWeight: 700, fill: '#94a3b8'}} 
                        label={primaryMetric === comparisonMetric ? undefined : { value: METRIC_CONFIG[primaryMetric]?.label, angle: -90, position: 'insideLeft', style: { fontSize: 9, fontWeight: 800, fill: '#94a3b8' } }}
                      />
                      {comparisonMetric !== 'none' && (
                        <YAxis 
                          yAxisId="right"
                          orientation="right"
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 10, fontWeight: 700, fill: '#94a3b8'}}
                          label={{ value: METRIC_CONFIG[comparisonMetric]?.label, angle: 90, position: 'insideRight', style: { fontSize: 9, fontWeight: 800, fill: '#94a3b8' } }}
                        />
                      )}
                      <RechartsTooltip content={<CustomTooltip primaryKey={primaryMetric} secondaryKey={comparisonMetric === 'none' ? undefined : comparisonMetric} />} />
                      <Line 
                        yAxisId="left"
                        type="monotone" 
                        dataKey={`metrics.${primaryMetric}`} 
                        stroke={METRIC_CONFIG[primaryMetric]?.color || '#000'} 
                        strokeWidth={4} 
                        dot={{ r: 4, fill: METRIC_CONFIG[primaryMetric]?.color || '#000', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                        animationDuration={1500}
                      />
                      {comparisonMetric !== 'none' && (
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey={`metrics.${comparisonMetric}`} 
                          stroke={METRIC_CONFIG[comparisonMetric]?.color || '#000'} 
                          strokeWidth={3} 
                          strokeDasharray="5 5"
                          dot={{ r: 3, fill: METRIC_CONFIG[comparisonMetric]?.color || '#000', strokeWidth: 1, stroke: '#fff' }}
                          animationDuration={1500}
                          opacity={0.6}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-subtle text-xs bg-gray-50 rounded-3xl">Insufficient data for trend visualization</div>
                )}
             </div>
          </div>

          {/* Layer 2: Top Sources Selection */}
          <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-6 transition-all duration-500", revealedIndex < 2 ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0")}>
              <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col h-full">
                 <div className="flex justify-between items-start mb-8 gap-4">
                    <div>
                      <h3 className="text-xl font-black text-ink tracking-tight">Top Contributors</h3>
                      <p className="text-subtle text-xs font-semibold mt-1">Leading {METRIC_CONFIG[primaryMetric]?.label} sources</p>
                    </div>
                    <div className="flex bg-gray-50 p-1 rounded-xl">
                      <button onClick={() => setTopSourceView('contribution')} className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", topSourceView === 'contribution' ? "bg-white shadow-sm text-ink" : "text-subtle")}>Value</button>
                      <button onClick={() => setTopSourceView('frequency')} className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", topSourceView === 'frequency' ? "bg-white shadow-sm text-ink" : "text-subtle")}>Freq</button>
                    </div>
                 </div>

                 <div className="space-y-6 flex-1">
                    {(() => {
                      const sourceData = topSourceView === 'contribution' 
                        ? (stats.topSources?.[primaryMetric]?.contribution || []) 
                        : (stats.topSources?.[primaryMetric]?.frequency || []);
                      
                      const maxVal = topSourceView === 'contribution' 
                        ? (stats.topSources?.[primaryMetric]?.contribution?.[0]?.value || 1)
                        : (stats.topSources?.[primaryMetric]?.frequency?.[0]?.count || 1);

                      if (sourceData.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center h-48 text-subtle/40 border-2 border-dashed border-gray-50 rounded-3xl">
                             <Info size={24} className="mb-2" />
                             <p className="text-[10px] font-bold uppercase tracking-widest">No contributors tracked</p>
                          </div>
                        );
                      }

                      return sourceData.map((item: any, index: number) => (
                        <div key={item.name} className="flex items-center gap-4 group">
                          <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-black transition-all group-hover:scale-110", index === 0 ? "bg-ink text-white" : "bg-gray-50 text-subtle")}>
                            #{index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                             <div className="flex justify-between items-baseline mb-2">
                                <span className="text-sm font-bold truncate text-ink pr-4">{item.name}</span>
                                <span className="text-xs font-mono font-black text-ink bg-gray-50 px-2 py-0.5 rounded-md">
                                  {topSourceView === 'contribution' ? `${item.value}${METRIC_CONFIG[primaryMetric]?.unit}` : `${item.count}×`}
                                </span>
                             </div>
                             <div className="w-full h-1.5 bg-gray-50 rounded-full overflow-hidden">
                                <motion.div 
                                   initial={{ width: 0 }}
                                   animate={{ width: `${( (item.value || item.count || 0) / maxVal ) * 100}%` }}
                                   transition={{ duration: 1, ease: "easeOut" }}
                                   className="h-full bg-ink rounded-full" 
                                />
                             </div>
                          </div>
                        </div>
                      ));
                    })()}
                 </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col h-full">
                 <div className="mb-8">
                    <h3 className="text-xl font-black text-ink tracking-tight">Category Impact</h3>
                    <p className="text-subtle text-xs font-semibold mt-1">Fiber distribution across meal types</p>
                 </div>
                 <div className="flex-1 min-h-[280px]">
                    {stats.distributions && stats.distributions.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.distributions} layout="vertical" margin={{ left: 0, right: 20 }}>
                          <XAxis type="number" hide />
                          <YAxis 
                            dataKey="name" 
                            type="category" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fontSize: 10, fontWeight: 800, fill: '#1e293b'}} 
                            width={90}
                          />
                          <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                          <Bar dataKey="fiber" radius={[0, 10, 10, 0]}>
                             {stats.distributions.map((_, index) => (
                               <Cell key={`cell-${index}`} fill={['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'][index % 5]} />
                             ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-subtle text-xs bg-gray-50 rounded-3xl">No category data available</div>
                    )}
                 </div>
              </div>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("CRITICAL: StatisticsView encountered a rendering error:", error);
    return (
      <div className="flex flex-col items-center justify-center h-[500px] text-center px-6 bg-white rounded-[2.5rem] border border-red-100 shadow-sm">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle size={48} className="text-red-500" />
        </div>
        <h3 className="text-2xl font-black mb-2 text-red-700">Analytics Error</h3>
        <p className="text-subtle text-sm max-w-sm mb-8">
          Something went wrong while processing your nutritional statistics. Our team has been notified.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-200"
        >
          Reload Dashboard
        </button>
      </div>
    );
  }
}

function TrendCard({ label, value, comparison, percent, unit = '', invertColor = false, color, bg }: { label: string, value: string, comparison?: number, percent?: number | 'n/a', unit?: string, invertColor?: boolean, color: string, bg: string }) {
  const isPositive = (comparison || 0) > 0;
  const isNeutral = comparison === undefined || comparison === null || comparison === 0;
  
  const isGoodTrend = invertColor ? !isPositive : isPositive;
  const trendColor = isNeutral ? "text-subtle" : isGoodTrend ? "text-green-600" : "text-red-600";
  const trendBg = isNeutral ? "bg-gray-50" : isGoodTrend ? "bg-green-50" : "bg-red-50";

  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-border shadow-sm flex flex-col justify-between group hover:border-ink/20 transition-all min-h-[160px]">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle mb-3 truncate">{label}</p>
        <div className={cn("text-4xl font-black tracking-tight", color)}>{value}</div>
      </div>
      {!isNeutral && (
        <div className={cn("mt-4 px-4 py-2 rounded-2xl flex items-center gap-2 self-start", trendBg)}>
          {isGoodTrend ? <ArrowUpRight size={16} className={trendColor} /> : <ArrowDownRight size={16} className={trendColor} />}
          <div className="flex items-baseline gap-1.5">
             <span className={cn("text-xs font-black", trendColor)}>
               {isPositive ? '+' : ''}{Math.abs(Number(comparison)).toFixed(comparison && Math.abs(comparison) < 1 ? 1 : 0)}{unit}
             </span>
             <span className="text-[9px] font-bold text-subtle/40 uppercase tracking-widest whitespace-nowrap">
               ({percent === 'n/a' ? 'n/a' : `${percent}%`})
             </span>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomTooltip({ active, payload, label, primaryKey, secondaryKey }: any) {
  if (active && payload && payload.length) {
    const configPrimary = METRIC_CONFIG[primaryKey];
    const configSecondary = secondaryKey ? METRIC_CONFIG[secondaryKey as MetricKey] : null;

    return (
      <div className="bg-ink text-white p-5 rounded-[1.5rem] shadow-2xl border border-white/10 min-w-[200px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-4 pb-2 border-b border-white/5">{label}</p>
        <div className="space-y-4">
           {/* Primary Metric */}
           <div className="flex justify-between items-center group">
              <div className="flex items-center gap-2">
                 <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: configPrimary?.color || '#000' }} />
                 <div>
                    <p className="text-[9px] font-black text-white/30 uppercase tracking-tight leading-none mb-1">{configPrimary?.label || 'Value'}</p>
                    <p className="text-lg font-black leading-none">{payload[0].value?.toFixed(primaryKey === 'fiber' ? 1 : 0)}<span className="text-[10px] ml-1 opacity-60">{configPrimary?.unit}</span></p>
                 </div>
              </div>
           </div>

           {/* Comparison Metric */}
           {secondaryKey && payload[1] && (
              <div className="flex justify-between items-center pt-3 border-t border-white/5">
                 <div className="flex items-center gap-2">
                    <div className="w-1.5 h-6 rounded-full opacity-60" style={{ backgroundColor: configSecondary?.color || '#000' }} />
                    <div>
                       <p className="text-[9px] font-black text-white/30 uppercase tracking-tight leading-none mb-1">{configSecondary?.label || 'Compare'}</p>
                       <p className="text-lg font-black leading-none opacity-90">{payload[1].value?.toFixed(secondaryKey === 'fiber' ? 1 : 0)}<span className="text-[10px] ml-1 opacity-60">{configSecondary?.unit}</span></p>
                    </div>
                 </div>
              </div>
           )}
        </div>
      </div>
    );
  }
  return null;
}

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { 
  Calendar, Download, Loader2, Info, Copy, Check
} from 'lucide-react';
import { Food, Meal } from '../types';
import { supabase } from '../lib/supabase';
import { buildExportRows } from '../lib/statsUtils';
import { generateRangeSummaryText } from '../lib/exportUtils';
import { cn, getFriendlyErrorMessage } from '../lib/utils';
import { getLocalDayBounds, normalizeDateToLocal } from '../lib/dateUtils';
import { mapMealRecord } from '../lib/mealItemUtils';
import { buildWeightTableCsvFromInput, buildWeightTableFilename, type WeightTableExportInput } from '../lib/weightExport';
import type { DailyWeightActivityLog } from '../lib/weightAnalytics';
import {
  buildExportRange,
  inferExportRangePreset,
  type ExportRangePreset,
  type ExportRange,
} from '../lib/exportRange';

interface UnifiedExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  user_id: string;
  foods: Food[];
  initialRange: { start: string, end: string };
  initialDataType?: ExportDataType;
  initialFormat?: ExportFormat;
  showToast: (text: string, type: 'success' | 'error') => void;
}

type ExportFormat = 'csv' | 'text' | 'pdf';
type ExportDataType = 'nutrition' | 'weight';

export default function UnifiedExportModal({ 
  isOpen, onClose, user_id, foods, initialRange, initialDataType, initialFormat, showToast 
}: UnifiedExportModalProps) {
  const today = normalizeDateToLocal(new Date());
  const [range, setRange] = useState<ExportRange>({ start: today, end: today });
  const [formatType, setFormatType] = useState<ExportFormat>('text');
  const [dataType, setDataType] = useState<ExportDataType>('nutrition');
  const [isExporting, setIsExporting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rangePreset, setRangePreset] = useState<ExportRangePreset>('today');

  const activePreset = inferExportRangePreset(range, new Date());

  useEffect(() => {
    if (!isOpen) return;
    const nextRange = initialRange?.start && initialRange?.end ? initialRange : buildExportRange('today');
    setRange(nextRange);
    setRangePreset(inferExportRangePreset(nextRange, new Date()));
    setDataType(initialDataType ?? 'nutrition');
    setFormatType(initialFormat ?? (initialDataType === 'weight' ? 'csv' : 'text'));
    setCopied(false);
  }, [isOpen, initialDataType, initialFormat, initialRange]);

  if (!isOpen) return null;

  const selectedRange = range.start <= range.end
    ? range
    : { start: range.end, end: range.start };

  const isWeightExport = dataType === 'weight';

  const handleSelectDataType = (nextDataType: ExportDataType) => {
    setDataType(nextDataType);
    setFormatType(nextDataType === 'weight' ? 'csv' : 'text');
  };

  const handleSelectPreset = (preset: ExportRangePreset) => {
    setRangePreset(preset);
    setRange(preset === 'custom_range' ? selectedRange : buildExportRange(preset));
    setCopied(false);
  };

  const handleRangeInputChange = (field: 'start' | 'end', value: string) => {
    setRangePreset('custom_range');
    setRange(prev => ({ ...prev, [field]: value }));
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const startBounds = getLocalDayBounds(selectedRange.start);
      const endBounds = getLocalDayBounds(selectedRange.end);

      if (!isWeightExport) {
        const { data, error } = await supabase
          .from('meals')
          .select('*, meal_items(*)')
          .eq('user_id', user_id)
          .gte('created_at', startBounds.start.toISOString())
          .lte('created_at', endBounds.end.toISOString());

        if (error) throw error;
        if (!data || data.length === 0) {
          showToast('No data found for this range', 'error');
          setIsExporting(false);
          return;
        }

        const mappedMeals: Meal[] = data.map((m: any) => mapMealRecord(m));

        if (formatType === 'csv') {
          exportToCSV(mappedMeals);
        } else if (formatType === 'text') {
          exportToText(mappedMeals);
        } else if (formatType === 'pdf') {
          showToast('PDF export is available directly from the Statistics page', 'success');
        }
        return;
      }

      const [{ data: mealRows, error: mealError }, { data: weightRows, error: weightError }] = await Promise.all([
        supabase
          .from('meals')
          .select('*, meal_items(*)')
          .eq('user_id', user_id)
          .gte('created_at', startBounds.start.toISOString())
          .lte('created_at', endBounds.end.toISOString()),
        supabase
          .from('weight_entries')
          .select('*')
          .eq('user_id', user_id)
          .gte('date', selectedRange.start)
          .lte('date', selectedRange.end)
          .order('date', { ascending: true }),
      ]);

      if (mealError) throw mealError;
      if (weightError) throw weightError;

      const mappedMeals: Meal[] = (mealRows || []).map((m: any) => mapMealRecord(m));
      const mappedWeightLogs: DailyWeightActivityLog[] = (weightRows || []).map((row: Record<string, any>) => {
        const weight = Number(row.weight ?? row.weight_kg ?? 0);
        return {
          date: String(row.date),
          weight,
          weightKg: weight,
          calories: row.calories ?? null,
          proteinGrams: row.protein_grams ?? null,
          carbsGrams: row.carbs_grams ?? null,
          fatGrams: row.fat_grams ?? null,
          alcoholGrams: row.alcohol_grams ?? null,
          activityTemplateId: row.activity_template_id ?? null,
          steps: row.steps ?? null,
          trainingMinutes: row.training_minutes ?? null,
          intensity: row.intensity ?? null,
          notes: row.notes ?? null,
          trendWeightKg: row.trend_weight_kg ?? null,
          isWeightOutlier: row.is_weight_outlier ?? false,
          isCalorieOutlier: row.is_calorie_outlier ?? false,
          excludeFromAdaptiveTDEE: row.exclude_from_adaptive_tdee ?? false,
        };
      });

      const csv = buildWeightTableCsvFromInput({
        weightLogs: mappedWeightLogs,
        meals: mappedMeals,
        foods,
        range: {
          start: startBounds.start,
          end: endBounds.end,
        },
      } satisfies WeightTableExportInput);

      const filename = buildWeightTableFilename({
        start: startBounds.start,
        end: endBounds.end,
      });

      downloadFile(`\uFEFF${csv}`, filename, 'text/csv;charset=utf-8;');
      showToast('Weight CSV exported!', 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast(getFriendlyErrorMessage(err), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async () => {
    if (isWeightExport) {
      showToast('Weight export is available as CSV only', 'error');
      return;
    }

    setIsCopying(true);
    try {
      const { data, error } = await supabase
        .from('meals')
        .select('*, meal_items(*)')
        .eq('user_id', user_id)
        .gte('created_at', getLocalDayBounds(selectedRange.start).start.toISOString())
        .lte('created_at', getLocalDayBounds(selectedRange.end).end.toISOString());

      if (error) throw error;
      if (!data || data.length === 0) {
        showToast('No data found for this range', 'error');
        return;
      }

      const mappedMeals: Meal[] = data.map((m: any) => mapMealRecord(m));

      const text = generateRangeSummaryText(mappedMeals, foods, selectedRange);
      await navigator.clipboard.writeText(text);
      
      setCopied(true);
      showToast('Summary copied to clipboard!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
      showToast('Failed to copy', 'error');
    } finally {
      setIsCopying(false);
    }
  };

  const exportToCSV = (meals: Meal[]) => {
    const rows = buildExportRows(meals, foods);
    const csvContent = rows.map(r => r.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const bom = '\uFEFF';
    downloadFile(bom + csvContent, `fibertrack-export-${selectedRange.start}-to-${selectedRange.end}.csv`, 'text/csv;charset=utf-8;');
    showToast('CSV Exported!', 'success');
  };

  const exportToText = (meals: Meal[]) => {
    const text = generateRangeSummaryText(meals, foods, selectedRange);
    downloadFile(text, `fibertrack-summary-${selectedRange.start}-to-${selectedRange.end}.txt`, 'text/plain;charset=utf-8;');
    showToast('Text Summary Exported!', 'success');
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
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
        className="relative w-full sm:max-w-lg bg-white rounded-t-[32px] sm:rounded-[32px] shadow-2xl p-5 sm:p-8 space-y-6 sm:space-y-8 max-h-[calc(100dvh-1rem)] overflow-y-auto"
      >
        <div className="text-center space-y-2">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Download size={32} strokeWidth={2.5} />
          </div>
          <h3 className="text-[22px] sm:text-[24px] font-[800] tracking-[-1px] leading-tight">Unified Export</h3>
          <p className="text-subtle text-[13px] sm:text-[14px]">Choose your data type, range, and format</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Data Type</label>
            <div className="grid grid-cols-2 gap-2">
              <SelectorButton
                active={!isWeightExport}
                onClick={() => handleSelectDataType('nutrition')}
                label="Nutrition / Meals"
                sub="Meals, summary, PDF"
              />
              <SelectorButton
                active={isWeightExport}
                onClick={() => handleSelectDataType('weight')}
                label="Weight"
                sub="Daily table CSV"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Range</label>
            <div className="md:hidden">
              <select
                value={rangePreset}
                onChange={e => handleSelectPreset(e.target.value as ExportRangePreset)}
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-[14px] font-semibold text-ink shadow-sm outline-none focus:ring-2 focus:ring-accent/20"
              >
                {[
                  { id: 'today', label: 'Today' },
                  { id: 'this_week', label: 'This Week' },
                  { id: 'last_7_days', label: 'Last 7 Days' },
                  { id: 'last_30_days', label: 'Last 30 Days' },
                  { id: 'custom_range', label: 'Custom Range' },
                ].map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="hidden md:flex flex-wrap gap-2">
              {(['today', 'this_week', 'last_7_days', 'last_30_days', 'custom_range'] as ExportRangePreset[]).map(preset => (
                <button
                  key={preset}
                  onClick={() => handleSelectPreset(preset)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-xs font-bold transition-colors',
                    activePreset === preset ? 'bg-ink text-white' : 'bg-gray-50 hover:bg-gray-100 text-ink'
                  )}
                >
                  {preset === 'today' ? 'Today' : preset === 'this_week' ? 'This Week' : preset === 'last_7_days' ? 'Last 7 Days' : preset === 'last_30_days' ? 'Last 30 Days' : 'Custom Range'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Start Date</label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/40" size={18} />
                <input
                  type="date"
                  value={range.start}
                  onChange={e => handleRangeInputChange('start', e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">End Date</label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/40" size={18} />
                <input
                  type="date"
                  value={range.end}
                  onChange={e => handleRangeInputChange('end', e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-sm"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Export Format</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <FormatButton 
                active={formatType === 'csv'} 
                onClick={() => setFormatType('csv')}
                label="CSV"
                sub="Sheets"
              />
              <FormatButton 
                active={formatType === 'text'} 
                onClick={() => setFormatType('text')}
                label="Text"
                sub={isWeightExport ? 'Unavailable' : 'Summary'}
                disabled={isWeightExport}
              />
              <FormatButton 
                active={formatType === 'pdf'} 
                onClick={() => setFormatType('pdf')}
                label="PDF"
                sub={isWeightExport ? 'Unavailable' : 'Report'}
                disabled={isWeightExport}
              />
            </div>
          </div>
          
          {isWeightExport ? (
            <div className="flex gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100 italic text-[12px] text-amber-800">
              <Info size={18} className="shrink-0" />
              Weight export is available as CSV only, with Date, Weight, and Calories columns.
            </div>
          ) : formatType === 'pdf' && (
             <div className="flex gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 italic text-[12px] text-blue-700">
               <Info size={18} className="shrink-0" />
               PDF reports are generated from the Statistics Page to include visual charts.
             </div>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={handleExport}
            disabled={isExporting || isCopying || (formatType === 'pdf')}
            className="w-full bg-ink text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-black transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isExporting ? <Loader2 className="animate-spin" size={20} /> : (formatType === 'pdf' ? 'Open Stats to Export' : isWeightExport ? 'Export CSV' : 'Export Data')}
          </button>
          
          <button
            onClick={handleCopy}
            disabled={isExporting || isCopying || isWeightExport}
            className="w-full bg-accent text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
          >
            {isCopying ? <Loader2 className="animate-spin" size={20} /> : (copied ? <Check size={20} /> : <Copy size={20} />)}
            {copied ? 'Copied!' : (isWeightExport ? 'CSV Only' : 'Copy Summary')}
          </button>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="w-full bg-gray-50 text-subtle py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:bg-gray-100 transition-all active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function SelectorButton({ active, onClick, label, sub }: { active: boolean, onClick: () => void, label: string, sub: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center py-4 rounded-2xl border transition-all",
        active 
          ? "bg-ink border-ink text-white shadow-lg scale-105" 
          : "bg-white border-border text-subtle hover:border-accent/40"
      )}
    >
      <span className="text-sm font-black">{label}</span>
      <span className={cn("text-[9px] uppercase tracking-widest font-bold", active ? "text-white/60" : "text-ink/40")}>{sub}</span>
    </button>
  );
}

function FormatButton({ active, onClick, label, sub, disabled = false }: { active: boolean, onClick: () => void, label: string, sub: string, disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center py-4 rounded-2xl border transition-all",
        disabled
          ? "bg-gray-50 border-gray-100 text-subtle opacity-60 cursor-not-allowed"
          : active
            ? "bg-ink border-ink text-white shadow-lg scale-105"
            : "bg-white border-border text-subtle hover:border-accent/40"
      )}
    >
      <span className="text-sm font-black">{label}</span>
      <span className={cn("text-[9px] uppercase tracking-widest font-bold", disabled ? "text-subtle/60" : active ? "text-white/60" : "text-ink/40")}>{sub}</span>
    </button>
  );
}

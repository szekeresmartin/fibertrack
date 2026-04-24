import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Calendar, FileText, Download, Loader2, Info, CheckCircle2, Copy, Check 
} from 'lucide-react';
import { format, subDays, parseISO, isAfter } from 'date-fns';
import { Food, Meal } from '../types';
import { supabase } from '../lib/supabase';
import { buildExportRows } from '../lib/statsUtils';
import { generateRangeSummaryText } from '../lib/exportUtils';
import { cn, getFriendlyErrorMessage } from '../lib/utils';

interface UnifiedExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  user_id: string;
  foods: Food[];
  initialRange: { start: string, end: string };
  showToast: (text: string, type: 'success' | 'error') => void;
}

type ExportFormat = 'csv' | 'text' | 'pdf';

export default function UnifiedExportModal({ 
  isOpen, onClose, user_id, foods, initialRange, showToast 
}: UnifiedExportModalProps) {
  const [range, setRange] = useState(initialRange);
  const [formatType, setFormatType] = useState<ExportFormat>('csv');
  const [isExporting, setIsExporting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // 1. Fetch data for the specified range
      const { data, error } = await supabase
        .from('meals')
        .select('*, meal_items(food_id, grams)')
        .eq('user_id', user_id)
        .gte('created_at', `${range.start}T00:00:00Z`)
        .lte('created_at', `${range.end}T23:59:59Z`);

      if (error) throw error;
      if (!data || data.length === 0) {
        showToast('No data found for this range', 'error');
        setIsExporting(false);
        return;
      }

      const mappedMeals: Meal[] = data.map((m: any) => ({
        ...m,
        items: (m.meal_items || []).map((mi: any) => ({
          foodId: mi.food_id,
          quantityGrams: mi.grams
        }))
      }));

      if (formatType === 'csv') {
        exportToCSV(mappedMeals);
      } else if (formatType === 'text') {
        exportToText(mappedMeals);
      } else if (formatType === 'pdf') {
        showToast('PDF export is available directly from the Statistics page', 'success');
      }

    } catch (err) {
      console.error('Export failed:', err);
      showToast(getFriendlyErrorMessage(err), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async () => {
    setIsCopying(true);
    try {
      const { data, error } = await supabase
        .from('meals')
        .select('*, meal_items(food_id, grams)')
        .eq('user_id', user_id)
        .gte('created_at', `${range.start}T00:00:00Z`)
        .lte('created_at', `${range.end}T23:59:59Z`);

      if (error) throw error;
      if (!data || data.length === 0) {
        showToast('No data found for this range', 'error');
        return;
      }

      const mappedMeals: Meal[] = data.map((m: any) => ({
        ...m,
        items: (m.meal_items || []).map((mi: any) => ({
          foodId: mi.food_id,
          quantityGrams: mi.grams
        }))
      }));

      const text = generateRangeSummaryText(mappedMeals, foods, range);
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
    downloadFile(bom + csvContent, `fibertrack-export-${range.start}-to-${range.end}.csv`, 'text/csv;charset=utf-8;');
    showToast('CSV Exported!', 'success');
  };

  const exportToText = (meals: Meal[]) => {
    const text = generateRangeSummaryText(meals, foods, range);
    downloadFile(text, `fibertrack-summary-${range.start}-to-${range.end}.txt`, 'text/plain;charset=utf-8;');
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
        className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl p-8 space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-accent/10 text-accent rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Download size={32} strokeWidth={2.5} />
          </div>
          <h3 className="text-[24px] font-[800] tracking-[-1px] leading-tight">Unified Export</h3>
          <p className="text-subtle text-[14px]">Choose your range and format</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
             <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Quick Presets</label>
             <div className="flex gap-2">
                <button 
                  onClick={() => setRange({ start: format(new Date(), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') })}
                  className="px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-bold text-ink transition-colors"
                >
                  Today
                </button>
                <button 
                  onClick={() => setRange({ start: format(subDays(new Date(), 6), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') })}
                  className="px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-bold text-ink transition-colors"
                >
                  Last 7 Days
                </button>
                <button 
                  onClick={() => setRange({ start: format(subDays(new Date(), 29), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') })}
                  className="px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-bold text-ink transition-colors"
                >
                  Last 30 Days
                </button>
             </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Start Date</label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/40" size={18} />
                <input
                  type="date"
                  value={range.start}
                  onChange={e => setRange(prev => ({ ...prev, start: e.target.value }))}
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
                  onChange={e => setRange(prev => ({ ...prev, end: e.target.value }))}
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-accent transition-all text-sm"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest ml-1">Export Format</label>
            <div className="grid grid-cols-3 gap-2">
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
                sub="Summary"
              />
              <FormatButton 
                active={formatType === 'pdf'} 
                onClick={() => setFormatType('pdf')}
                label="PDF"
                sub="Report"
              />
            </div>
          </div>
          
          {formatType === 'pdf' && (
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
            {isExporting ? <Loader2 className="animate-spin" size={20} /> : (formatType === 'pdf' ? 'Open Stats to Export' : 'Export Data')}
          </button>
          
          <button
            onClick={handleCopy}
            disabled={isExporting || isCopying}
            className="w-full bg-accent text-white py-4 rounded-2xl font-bold text-[14px] uppercase tracking-[0.1em] hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
          >
            {isCopying ? <Loader2 className="animate-spin" size={20} /> : (copied ? <Check size={20} /> : <Copy size={20} />)}
            {copied ? 'Copied!' : 'Copy Summary'}
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

function FormatButton({ active, onClick, label, sub }: { active: boolean, onClick: () => void, label: string, sub: string }) {
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

import { useMemo } from 'react';
import { subDays, startOfDay } from 'date-fns';
import { calculateMovingAverage, WeightLog } from '../weightUtils';

export function useWeightChartData(weightLogs: WeightLog[], days: number) {
  return useMemo(() => {
    if (!weightLogs || weightLogs.length === 0) return [];
    
    const sortedLogs = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date));
    const logsWithMA = calculateMovingAverage(sortedLogs, 7);
    
    const referenceDate = startOfDay(new Date());
    const startDate = subDays(referenceDate, days - 1);
    
    const filteredLogs = logsWithMA.filter(log => {
      const date = typeof log.date === 'string' ? new Date(log.date) : log.date;
      return startOfDay(date) >= startDate;
    });
    
    // Fallback: if no data in current period, return last 7 entries
    const displayLogs = filteredLogs.length > 0 ? filteredLogs : logsWithMA.slice(-7);

    return displayLogs.map(log => ({
        // Keep as string for Recharts, formatters in UI will handle the display
        date: log.date, 
        weight: log.weight,
        movingAverage: log.movingAverage
      }));
  }, [weightLogs, days]);
}

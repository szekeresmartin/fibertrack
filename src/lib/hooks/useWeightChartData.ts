import { useMemo } from 'react';
import { subDays, startOfDay } from 'date-fns';
import { calculateMovingAverage, WeightLog } from '../weightUtils';
import { parseLocalDateInput } from '../dateUtils';

export function useWeightChartData(weightLogs: WeightLog[], days: number) {
  return useMemo(() => {
    if (!weightLogs || weightLogs.length === 0) return [];
    
    const sortedLogs = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date));
    
    const referenceDate = startOfDay(new Date());
    const startDate = subDays(referenceDate, days - 1);

    const filteredBaseLogs = sortedLogs.filter(log => {
      const date = parseLocalDateInput(log.date);
      return !!date && startOfDay(date) >= startDate && startOfDay(date) <= referenceDate;
    });

    const logsWithMA = calculateMovingAverage(filteredBaseLogs, 7);

    return logsWithMA.map(log => ({
        // Keep as string for Recharts, formatters in UI will handle the display
        date: log.date, 
        weight: log.weight,
        movingAverage: log.movingAverage
      }));
  }, [weightLogs, days]);
}

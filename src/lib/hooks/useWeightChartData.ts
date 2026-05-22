import { useMemo } from 'react';
import { subDays, startOfDay } from 'date-fns';
import { calculateMovingAverage, WeightLog } from '../weightUtils';
import { parseLocalDateInput } from '../dateUtils';

export function useWeightChartData(weightLogs: WeightLog[], days: number) {
  return useMemo(() => {
    if (!weightLogs || weightLogs.length === 0) return [];
    
    const sortedLogs = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date));
    const logsWithMA = calculateMovingAverage(sortedLogs, 7);
    
    const referenceDate = startOfDay(new Date());
    const startDate = subDays(referenceDate, days - 1);
    
    const filteredLogs = logsWithMA.filter(log => {
      const date = parseLocalDateInput(log.date);
      return !!date && startOfDay(date) >= startDate;
    });

    return filteredLogs.map(log => ({
        // Keep as string for Recharts, formatters in UI will handle the display
        date: log.date, 
        weight: log.weight,
        movingAverage: log.movingAverage
      }));
  }, [weightLogs, days]);
}

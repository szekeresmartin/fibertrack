import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteActivityDayTemplate,
  deleteWeightLog,
  ensureDefaultActivityDayTemplates,
  fetchActivityDayTemplates,
  fetchWeightLogs,
  upsertActivityDayTemplate,
  upsertDailyWeightActivityLog,
  upsertWeightLog,
} from '../services/weightService';
import { WeightLog } from '../weightUtils';
import { ActivityDayTemplate, DailyWeightActivityLog } from '../weightAnalytics';

export const WEIGHT_LOGS_QUERY_KEY = ['weightLogs'];
export const ACTIVITY_TEMPLATES_QUERY_KEY = ['activityTemplates'];

/**
 * Hook to fetch all weight logs for a specific user using the weight service.
 */
export function useWeightLogs(userId: string | undefined) {
  return useQuery<WeightLog[]>({
    queryKey: [...WEIGHT_LOGS_QUERY_KEY, { userId }],
    queryFn: () => {
      if (!userId) return Promise.resolve([]);
      return fetchWeightLogs(userId);
    },
    enabled: !!userId,
  });
}

export function useActivityDayTemplates(userId: string | undefined) {
  return useQuery<ActivityDayTemplate[]>({
    queryKey: [...ACTIVITY_TEMPLATES_QUERY_KEY, { userId }],
    queryFn: async () => {
      if (!userId) return [];
      await ensureDefaultActivityDayTemplates(userId);
      return fetchActivityDayTemplates(userId);
    },
    enabled: !!userId,
  });
}

/**
 * Hook to upsert a weight log using the weight service.
 */
export function useUpsertWeightLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, date, weight }: { userId: string; date: string; weight: number }) => {
      return upsertWeightLog(userId, date, weight);
    },
    onMutate: async (variables): Promise<{ previousLogs?: WeightLog[] }> => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      await queryClient.cancelQueries({ queryKey });

      const previousLogs = queryClient.getQueryData<WeightLog[]>(queryKey);

      queryClient.setQueryData<WeightLog[]>(queryKey, (old) => {
        const optimisticLog: WeightLog = { date: variables.date, weight: variables.weight };
        if (!old) return [optimisticLog];
        
        const exists = old.some(log => log.date === variables.date);
        if (exists) {
          return old.map(log => log.date === variables.date ? optimisticLog : log);
        }
        return [...old, optimisticLog].sort((a, b) => a.date.localeCompare(b.date));
      });

      return { previousLogs };
    },
    onError: (_err, variables, context) => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      if (context?.previousLogs) {
        queryClient.setQueryData(queryKey, context.previousLogs);
      }
    },
    onSuccess: (_, variables) => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useUpsertDailyWeightActivityLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, date, entry }: { userId: string; date: string; entry: Partial<DailyWeightActivityLog> }) => {
      return upsertDailyWeightActivityLog(userId, date, entry);
    },
    onMutate: async (variables): Promise<{ previousLogs?: WeightLog[] }> => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      await queryClient.cancelQueries({ queryKey });

      const previousLogs = queryClient.getQueryData<WeightLog[]>(queryKey);

      queryClient.setQueryData<WeightLog[]>(queryKey, (old) => {
        const optimisticLog: WeightLog = {
          date: variables.date,
          weight: Number(variables.entry.weightKg ?? variables.entry.weight ?? 0),
          weightKg: Number(variables.entry.weightKg ?? variables.entry.weight ?? 0),
          calories: variables.entry.calories ?? null,
          proteinGrams: variables.entry.proteinGrams ?? null,
          carbsGrams: variables.entry.carbsGrams ?? null,
          fatGrams: variables.entry.fatGrams ?? null,
          alcoholGrams: variables.entry.alcoholGrams ?? null,
          activityTemplateId: variables.entry.activityTemplateId ?? null,
          steps: variables.entry.steps ?? null,
          trainingMinutes: variables.entry.trainingMinutes ?? null,
          intensity: variables.entry.intensity ?? null,
          notes: variables.entry.notes ?? null,
          trendWeightKg: variables.entry.trendWeightKg ?? null,
          isWeightOutlier: variables.entry.isWeightOutlier ?? false,
          isCalorieOutlier: variables.entry.isCalorieOutlier ?? false,
          excludeFromAdaptiveTDEE: variables.entry.excludeFromAdaptiveTDEE ?? false,
        };

        if (!old) return [optimisticLog];
        const exists = old.some((log) => log.date === variables.date);
        if (exists) {
          return old.map((log) => (log.date === variables.date ? optimisticLog : log));
        }
        return [...old, optimisticLog].sort((a, b) => a.date.localeCompare(b.date));
      });

      return { previousLogs };
    },
    onError: (_err, variables, context) => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      if (context?.previousLogs) {
        queryClient.setQueryData(queryKey, context.previousLogs);
      }
    },
    onSuccess: (_, variables) => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Hook to delete a weight log using the weight service.
 */
export function useDeleteWeightLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, date }: { userId: string; date: string }) => {
      return deleteWeightLog(userId, date);
    },
    onMutate: async (variables): Promise<{ previousLogs?: WeightLog[] }> => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      await queryClient.cancelQueries({ queryKey });

      const previousLogs = queryClient.getQueryData<WeightLog[]>(queryKey);

      queryClient.setQueryData<WeightLog[]>(queryKey, (old) => {
        if (!old) return [];
        return old.filter(log => log.date !== variables.date);
      });

      return { previousLogs };
    },
    onError: (_err, variables, context) => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      if (context?.previousLogs) {
        queryClient.setQueryData(queryKey, context.previousLogs);
      }
    },
    onSuccess: (_, variables) => {
      const queryKey = [...WEIGHT_LOGS_QUERY_KEY, { userId: variables.userId }];
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useUpsertActivityDayTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: upsertActivityDayTemplate,
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: [...ACTIVITY_TEMPLATES_QUERY_KEY, { userId: variables.userId }] });
    },
  });
}

export function useDeleteActivityDayTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteActivityDayTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACTIVITY_TEMPLATES_QUERY_KEY });
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWeightLogs, upsertWeightLog } from '../services/weightService';
import { WeightLog } from '../weightUtils';

export const WEIGHT_LOGS_QUERY_KEY = ['weightLogs'];

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

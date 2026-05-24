import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyCompositionMeasurement } from '../bodyComposition';
import {
  deleteBodyCompositionMeasurement,
  fetchBodyCompositionMeasurements,
  upsertBodyCompositionMeasurement,
} from '../services/bodyCompositionService';

export const BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY = ['bodyCompositionMeasurements'];

function sortMeasurements(measurements: BodyCompositionMeasurement[]) {
  return [...measurements].sort((a, b) => {
    const dateDiff = b.measuredAt.localeCompare(a.measuredAt);
    if (dateDiff !== 0) return dateDiff;
    return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '');
  });
}

export function useBodyCompositionMeasurements(userId: string | undefined) {
  return useQuery<BodyCompositionMeasurement[]>({
    queryKey: [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId }],
    queryFn: () => {
      if (!userId) return Promise.resolve([]);
      return fetchBodyCompositionMeasurements(userId);
    },
    enabled: !!userId,
  });
}

export function useUpsertBodyCompositionMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      measurement,
    }: {
      userId: string;
      measurement: Partial<BodyCompositionMeasurement> & { measuredAt: string; source: string };
    }) => upsertBodyCompositionMeasurement(userId, measurement),
    onMutate: async (variables): Promise<{ previousMeasurements?: BodyCompositionMeasurement[] }> => {
      const queryKey = [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId: variables.userId }];
      await queryClient.cancelQueries({ queryKey });

      const previousMeasurements = queryClient.getQueryData<BodyCompositionMeasurement[]>(queryKey);
      const optimisticMeasurement: BodyCompositionMeasurement = {
        id: variables.measurement.id ?? `temp-${Date.now()}`,
        userId: variables.userId,
        measuredAt: variables.measurement.measuredAt,
        source: variables.measurement.source,
        weightKg: variables.measurement.weightKg ?? null,
        bodyFatPercent: variables.measurement.bodyFatPercent ?? null,
        bodyFatMassKg: variables.measurement.bodyFatMassKg ?? null,
        skeletalMuscleMassKg: variables.measurement.skeletalMuscleMassKg ?? null,
        basalMetabolicRateKcal: variables.measurement.basalMetabolicRateKcal ?? null,
        visceralFatLevel: variables.measurement.visceralFatLevel ?? null,
        ecwRatio: variables.measurement.ecwRatio ?? null,
        bodyCellMassKg: variables.measurement.bodyCellMassKg ?? null,
        notes: variables.measurement.notes ?? null,
        createdAt: variables.measurement.createdAt ?? undefined,
        updatedAt: variables.measurement.updatedAt ?? undefined,
      };

      queryClient.setQueryData<BodyCompositionMeasurement[]>(queryKey, (old) => {
        const current = old ? [...old] : [];
        const index = current.findIndex((measurement) => measurement.id === optimisticMeasurement.id);

        if (index >= 0) {
          current[index] = optimisticMeasurement;
        } else {
          current.unshift(optimisticMeasurement);
        }

        return sortMeasurements(current);
      });

      return { previousMeasurements };
    },
    onError: (_error, variables, context) => {
      const queryKey = [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId: variables.userId }];
      if (context?.previousMeasurements) {
        queryClient.setQueryData(queryKey, context.previousMeasurements);
      }
    },
    onSuccess: (_, variables) => {
      const queryKey = [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId: variables.userId }];
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useDeleteBodyCompositionMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, measurementId }: { userId: string; measurementId: string }) =>
      deleteBodyCompositionMeasurement(userId, measurementId),
    onMutate: async (variables): Promise<{ previousMeasurements?: BodyCompositionMeasurement[] }> => {
      const queryKey = [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId: variables.userId }];
      await queryClient.cancelQueries({ queryKey });

      const previousMeasurements = queryClient.getQueryData<BodyCompositionMeasurement[]>(queryKey);

      queryClient.setQueryData<BodyCompositionMeasurement[]>(queryKey, (old) => {
        if (!old) return [];
        return old.filter((measurement) => measurement.id !== variables.measurementId);
      });

      return { previousMeasurements };
    },
    onError: (_error, variables, context) => {
      const queryKey = [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId: variables.userId }];
      if (context?.previousMeasurements) {
        queryClient.setQueryData(queryKey, context.previousMeasurements);
      }
    },
    onSuccess: (_, variables) => {
      const queryKey = [...BODY_COMPOSITION_MEASUREMENTS_QUERY_KEY, { userId: variables.userId }];
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

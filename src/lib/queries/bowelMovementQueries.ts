import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteBowelMovement, fetchBowelMovements, upsertBowelMovement } from '../services/bowelMovementService';
import type { BowelMovement } from '../bowelMovements';

export const BOWEL_MOVEMENTS_QUERY_KEY = ['bowelMovements'];

export function useBowelMovements(userId: string | undefined) {
  return useQuery<BowelMovement[]>({
    queryKey: [...BOWEL_MOVEMENTS_QUERY_KEY, { userId }],
    queryFn: () => {
      if (!userId) return Promise.resolve([]);
      return fetchBowelMovements(userId, { ascending: false });
    },
    enabled: !!userId,
  });
}

export function useUpsertBowelMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      occurredAt,
      notes,
      id,
    }: {
      userId: string;
      occurredAt: string;
      notes?: string | null;
      id?: string;
    }) => upsertBowelMovement(userId, { occurredAt, notes, id }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...BOWEL_MOVEMENTS_QUERY_KEY, { userId: variables.userId }] });
    },
  });
}

export function useDeleteBowelMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, id }: { userId: string; id: string }) => deleteBowelMovement(userId, id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...BOWEL_MOVEMENTS_QUERY_KEY, { userId: variables.userId }] });
    },
  });
}

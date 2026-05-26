import { supabase } from '../supabase';
import {
  buildBowelMovementPayload,
  mapBowelMovementRow,
  type BowelMovement,
} from '../bowelMovements';

type BowelMovementRow = Record<string, any>;

export interface FetchBowelMovementsOptions {
  start?: string;
  end?: string;
  limit?: number;
  ascending?: boolean;
}

export async function fetchBowelMovements(userId: string, options: FetchBowelMovementsOptions = {}): Promise<BowelMovement[]> {
  let query = supabase
    .from('bowel_movements')
    .select('*')
    .eq('user_id', userId);

  if (options.start) {
    query = query.gte('occurred_at', options.start);
  }

  if (options.end) {
    query = query.lte('occurred_at', options.end);
  }

  query = query.order('occurred_at', { ascending: options.ascending ?? false });

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []).map((row: BowelMovementRow) => mapBowelMovementRow(row));
}

export async function upsertBowelMovement(
  userId: string,
  entry: { occurredAt: string; notes?: string | null; id?: string }
) {
  const payload = buildBowelMovementPayload(userId, entry.occurredAt, entry.notes);

  const request = entry.id
    ? supabase
        .from('bowel_movements')
        .update(payload)
        .eq('id', entry.id)
        .eq('user_id', userId)
        .select('*')
        .single()
    : supabase
        .from('bowel_movements')
        .insert(payload)
        .select('*')
        .single();

  const { data, error } = await request;

  if (error) throw error;
  return mapBowelMovementRow(data);
}

export async function deleteBowelMovement(userId: string, id: string) {
  const { error } = await supabase
    .from('bowel_movements')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}

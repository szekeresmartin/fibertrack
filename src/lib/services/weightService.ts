import { supabase } from '../supabase';
import { WeightLog } from '../weightUtils';

/**
 * Service to fetch all weight logs for a user from Supabase.
 */
export async function fetchWeightLogs(userId: string): Promise<WeightLog[]> {
  const { data, error } = await supabase
    .from('weight_entries')
    .select('date, weight')
    .eq('user_id', userId)
    .order('date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Service to upsert a weight log in Supabase.
 */
export async function upsertWeightLog(userId: string, date: string, weight: number) {
  const { data, error } = await supabase
    .from('weight_entries')
    .upsert(
      { user_id: userId, date, weight },
      { onConflict: 'user_id, date' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

import { supabase } from '../supabase';
import { mapBodyCompositionMeasurementRow, toNullableNumber } from '../bodyComposition';
import type { BodyCompositionMeasurement } from '../bodyComposition';

type BodyCompositionMeasurementRow = Record<string, any>;

function buildBodyCompositionPayload(
  userId: string,
  measurement: Partial<BodyCompositionMeasurement> & { measuredAt: string; source: string }
) {
  return {
    user_id: userId,
    measured_at: measurement.measuredAt,
    source: measurement.source,
    weight_kg: toNullableNumber(measurement.weightKg),
    body_fat_percent: toNullableNumber(measurement.bodyFatPercent),
    body_fat_mass_kg: toNullableNumber(measurement.bodyFatMassKg),
    skeletal_muscle_mass_kg: toNullableNumber(measurement.skeletalMuscleMassKg),
    basal_metabolic_rate_kcal: toNullableNumber(measurement.basalMetabolicRateKcal),
    visceral_fat_level: toNullableNumber(measurement.visceralFatLevel),
    ecw_ratio: toNullableNumber(measurement.ecwRatio),
    body_cell_mass_kg: toNullableNumber(measurement.bodyCellMassKg),
    notes: measurement.notes ?? null,
  };
}

export async function fetchBodyCompositionMeasurements(userId: string): Promise<BodyCompositionMeasurement[]> {
  const { data, error } = await supabase
    .from('body_composition_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row: BodyCompositionMeasurementRow) => mapBodyCompositionMeasurementRow(row));
}

export async function upsertBodyCompositionMeasurement(
  userId: string,
  measurement: Partial<BodyCompositionMeasurement> & { measuredAt: string; source: string }
) {
  const payload = buildBodyCompositionPayload(userId, measurement);

  const request = measurement.id
    ? supabase
        .from('body_composition_measurements')
        .update(payload)
        .eq('id', measurement.id)
        .eq('user_id', userId)
        .select('*')
        .single()
    : supabase
        .from('body_composition_measurements')
        .insert(payload)
        .select('*')
        .single();

  const { data, error } = await request;

  if (error) throw error;
  return mapBodyCompositionMeasurementRow(data);
}

export async function deleteBodyCompositionMeasurement(userId: string, measurementId: string) {
  const { error } = await supabase
    .from('body_composition_measurements')
    .delete()
    .eq('id', measurementId)
    .eq('user_id', userId);

  if (error) throw error;
}

export interface BodyCompositionMeasurement {
  id: string;
  userId: string;
  measuredAt: string;
  source: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  bodyFatMassKg: number | null;
  skeletalMuscleMassKg: number | null;
  basalMetabolicRateKcal: number | null;
  visceralFatLevel: number | null;
  ecwRatio: number | null;
  bodyCellMassKg: number | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function mapBodyCompositionMeasurementRow(row: Record<string, any>): BodyCompositionMeasurement {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    measuredAt: String(row.measured_at),
    source: String(row.source ?? 'InBody'),
    weightKg: toNullableNumber(row.weight_kg),
    bodyFatPercent: toNullableNumber(row.body_fat_percent),
    bodyFatMassKg: toNullableNumber(row.body_fat_mass_kg),
    skeletalMuscleMassKg: toNullableNumber(row.skeletal_muscle_mass_kg),
    basalMetabolicRateKcal: toNullableNumber(row.basal_metabolic_rate_kcal),
    visceralFatLevel: toNullableNumber(row.visceral_fat_level),
    ecwRatio: toNullableNumber(row.ecw_ratio),
    bodyCellMassKg: toNullableNumber(row.body_cell_mass_kg),
    notes: row.notes ?? null,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}


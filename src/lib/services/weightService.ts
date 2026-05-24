import { supabase } from '../supabase';
import {
  ActivityDayTemplate,
  ConfidenceLevel,
  DailyWeightActivityLog,
  getDefaultActivityDayTemplates,
  type ActivityIntensity,
} from '../weightAnalytics';
import { WeightLog } from '../weightUtils';

type WeightEntryRow = Record<string, any>;
type ActivityTemplateRow = Record<string, any>;

function mapWeightEntryRow(row: WeightEntryRow): DailyWeightActivityLog {
  const weight = Number(row.weight ?? row.weight_kg ?? 0);
  return {
    date: String(row.date),
    weight,
    weightKg: weight,
    calories: row.calories ?? null,
    proteinGrams: row.protein_grams ?? null,
    carbsGrams: row.carbs_grams ?? null,
    fatGrams: row.fat_grams ?? null,
    alcoholGrams: row.alcohol_grams ?? null,
    activityTemplateId: row.activity_template_id ?? null,
    steps: row.steps ?? null,
    trainingMinutes: row.training_minutes ?? null,
    intensity: (row.intensity ?? null) as ActivityIntensity | null,
    notes: row.notes ?? null,
    trendWeightKg: row.trend_weight_kg ?? null,
    isWeightOutlier: row.is_weight_outlier ?? false,
    isCalorieOutlier: row.is_calorie_outlier ?? false,
    excludeFromAdaptiveTDEE: row.exclude_from_adaptive_tdee ?? false,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

function mapActivityTemplateRow(row: ActivityTemplateRow): ActivityDayTemplate {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    templateKey: row.template_key ?? null,
    name: String(row.name),
    type: row.type,
    defaultSteps: row.default_steps ?? null,
    defaultTrainingMinutes: row.default_training_minutes ?? null,
    defaultIntensity: (row.default_intensity ?? null) as ActivityIntensity | null,
    estimatedActivityKcal: row.estimated_activity_kcal ?? 0,
    learnedOffsetKcal: row.learned_offset_kcal ?? null,
    confidence: (row.confidence ?? 'insufficient_data') as ConfidenceLevel,
    includeInAdaptiveModel: row.include_in_adaptive_model ?? true,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function buildWeightEntryPayload(userId: string, date: string, entry: Partial<DailyWeightActivityLog>) {
  const weight = Number(entry.weightKg ?? entry.weight ?? 0);

  return {
    user_id: userId,
    date,
    weight,
    calories: entry.calories ?? null,
    protein_grams: entry.proteinGrams ?? null,
    carbs_grams: entry.carbsGrams ?? null,
    fat_grams: entry.fatGrams ?? null,
    alcohol_grams: entry.alcoholGrams ?? null,
    activity_template_id: entry.activityTemplateId ?? null,
    steps: entry.steps ?? null,
    training_minutes: entry.trainingMinutes ?? null,
    intensity: entry.intensity ?? null,
    notes: entry.notes ?? null,
    trend_weight_kg: entry.trendWeightKg ?? null,
    is_weight_outlier: entry.isWeightOutlier ?? false,
    is_calorie_outlier: entry.isCalorieOutlier ?? false,
    exclude_from_adaptive_tdee: entry.excludeFromAdaptiveTDEE ?? false,
  };
}

export async function fetchWeightLogs(userId: string): Promise<WeightLog[]> {
  const { data, error } = await supabase
    .from('weight_entries')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => mapWeightEntryRow(row));
}

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

export async function upsertDailyWeightActivityLog(userId: string, date: string, entry: Partial<DailyWeightActivityLog>) {
  const payload = buildWeightEntryPayload(userId, date, entry);
  const { data, error } = await supabase
    .from('weight_entries')
    .upsert(payload, { onConflict: 'user_id, date' })
    .select('*')
    .single();

  if (error) throw error;
  return mapWeightEntryRow(data);
}

export async function deleteWeightLog(userId: string, date: string) {
  const { error } = await supabase
    .from('weight_entries')
    .delete()
    .eq('user_id', userId)
    .eq('date', date);

  if (error) throw error;
}

export async function fetchActivityDayTemplates(userId: string): Promise<ActivityDayTemplate[]> {
  const { data, error } = await supabase
    .from('activity_day_templates')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => mapActivityTemplateRow(row));
}

export async function ensureDefaultActivityDayTemplates(userId: string): Promise<ActivityDayTemplate[]> {
  const defaults = getDefaultActivityDayTemplates(userId);
  const payload = defaults.map((template) => ({
    user_id: userId,
    template_key: template.templateKey,
    name: template.name,
    type: template.type,
    default_steps: template.defaultSteps ?? null,
    default_training_minutes: template.defaultTrainingMinutes ?? null,
    default_intensity: template.defaultIntensity ?? null,
    estimated_activity_kcal: template.estimatedActivityKcal ?? 0,
    learned_offset_kcal: template.learnedOffsetKcal ?? null,
    confidence: template.confidence ?? 'insufficient_data',
    include_in_adaptive_model: template.includeInAdaptiveModel ?? true,
    is_default: template.isDefault ?? true,
  }));

  const { data, error } = await supabase
    .from('activity_day_templates')
    .upsert(payload, { onConflict: 'user_id, template_key' })
    .select('*');

  if (error) throw error;
  return (data || []).map((row) => mapActivityTemplateRow(row));
}

export async function upsertActivityDayTemplate(template: Partial<ActivityDayTemplate> & { userId: string }) {
  const payload = {
    user_id: template.userId,
    template_key: template.templateKey ?? null,
    name: template.name,
    type: template.type,
    default_steps: template.defaultSteps ?? null,
    default_training_minutes: template.defaultTrainingMinutes ?? null,
    default_intensity: template.defaultIntensity ?? null,
    estimated_activity_kcal: template.estimatedActivityKcal ?? 0,
    learned_offset_kcal: template.learnedOffsetKcal ?? null,
    confidence: template.confidence ?? 'insufficient_data',
    include_in_adaptive_model: template.includeInAdaptiveModel ?? true,
    is_default: template.isDefault ?? false,
  };

  const request = template.id
    ? supabase
        .from('activity_day_templates')
        .update(payload)
        .eq('id', template.id)
        .select('*')
        .single()
    : supabase
        .from('activity_day_templates')
        .upsert(payload, { onConflict: template.templateKey ? 'user_id, template_key' : undefined })
        .select('*')
        .single();

  const { data, error } = await request;

  if (error) throw error;
  return mapActivityTemplateRow(data);
}

export async function deleteActivityDayTemplate(templateId: string) {
  const { error } = await supabase
    .from('activity_day_templates')
    .delete()
    .eq('id', templateId);

  if (error) throw error;
}

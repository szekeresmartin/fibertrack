import { eachDayOfInterval, differenceInCalendarDays, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Food, Meal } from '../types';
import { calculateMealTotals, getFoodOrUnknown } from './utils';
import { normalizeDateToLocal, parseLocalDateInput } from './dateUtils';
import { WeightLog } from './weightUtils';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type ActivityIntensity = 'low' | 'moderate' | 'high' | 'very_high';
export type ConfidenceLevel = 'insufficient_data' | 'low' | 'medium' | 'high';
export type ActivityTemplateType = 'rest' | 'gym' | 'match' | 'hike' | 'custom';
export type FormulaBodyFatSource = 'latest body composition measurement' | 'manual fallback' | 'unavailable';

export interface WeightProfile {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  bodyFatPercent?: number | null;
  activityLevel: ActivityLevel;
}

export function resolveFormulaBodyFatPercent(
  latestMeasurementBodyFatPercent: number | null | undefined,
  manualBodyFatPercent: number | null | undefined
): { bodyFatPercent: number | null; source: FormulaBodyFatSource } {
  const latestBodyFatPercent = Number.isFinite(latestMeasurementBodyFatPercent ?? NaN)
    ? Number(latestMeasurementBodyFatPercent)
    : null;
  if (latestBodyFatPercent !== null) {
    return { bodyFatPercent: latestBodyFatPercent, source: 'latest body composition measurement' };
  }

  const fallbackBodyFatPercent = Number.isFinite(manualBodyFatPercent ?? NaN) ? Number(manualBodyFatPercent) : null;
  if (fallbackBodyFatPercent !== null) {
    return { bodyFatPercent: fallbackBodyFatPercent, source: 'manual fallback' };
  }

  return { bodyFatPercent: null, source: 'unavailable' };
}

export interface ActivityDayTemplate {
  id: string;
  userId: string;
  templateKey?: string | null;
  name: string;
  type: ActivityTemplateType;
  defaultSteps?: number | null;
  defaultTrainingMinutes?: number | null;
  defaultIntensity?: ActivityIntensity | null;
  estimatedActivityKcal?: number | null;
  learnedOffsetKcal?: number | null;
  confidence?: ConfidenceLevel;
  includeInAdaptiveModel: boolean;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyWeightActivityLog extends WeightLog {
  calories?: number | null;
  proteinGrams?: number | null;
  carbsGrams?: number | null;
  fatGrams?: number | null;
  alcoholGrams?: number | null;
  activityTemplateId?: string | null;
  steps?: number | null;
  trainingMinutes?: number | null;
  intensity?: ActivityIntensity | null;
  notes?: string | null;
  trendWeightKg?: number | null;
  activityEstimatedKcal?: number | null;
}

export interface AdaptiveTDEEEstimate {
  windowDays: number;
  method: 'formula' | 'adaptive' | 'hybrid';
  formulaTDEE?: number | null;
  adaptiveTDEE?: number | null;
  finalTDEE: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  avgCalories: number | null;
  weightSlopeKgPerDay: number;
  weeklyWeightChangeKg: number;
  estimatedDailyEnergyBalance: number;
  calorieDaysCount: number;
  weightEntriesCount: number;
  activityTaggedDaysCount: number;
  calorieCoverage: number;
  weightCoverage: number;
  activityCoverage: number;
  outlierDaysCount: number;
  confidence: ConfidenceLevel;
  score: number;
  dataSpanDays: number;
  missingCalorieDaysNeeded: number;
  missingWeightEntriesNeeded: number;
  notes: string[];
  trendSeries: Array<{ date: string; weightKg: number | null; trendWeightKg: number | null }>;
}

export interface TemplateTDEEEstimate {
  templateId: string;
  templateName: string;
  templateType: ActivityTemplateType;
  userId: string;
  baseTDEE: number | null;
  estimatedTemplateTDEE: number | null;
  estimatedActivityKcal: number;
  learnedOffsetKcal?: number | null;
  sampleDays: number;
  confidence: ConfidenceLevel;
  calculatedAt: string;
}

export interface WeightHubDailyIntake {
  date: string;
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  alcoholGrams: number | null;
  mealCount: number;
}

export interface WeightHubSeriesPoint {
  date: string;
  weightKg: number | null;
  trendWeightKg: number | null;
  calories: number | null;
  activityTemplateId: string | null;
  steps: number | null;
  trainingMinutes: number | null;
  intensity: ActivityIntensity | null;
  notes: string | null;
  isWeightOutlier: boolean;
  isCalorieOutlier: boolean;
  excludeFromAdaptiveTDEE: boolean;
  templateEstimatedActivityKcal: number | null;
}

const DEFAULT_TEMPLATE_KEYS: Array<{ key: string; name: string; type: ActivityTemplateType; steps: number; trainingMinutes: number; intensity: ActivityIntensity; estimatedActivityKcal: number }> = [
  { key: 'rest', name: 'Rest day', type: 'rest', steps: 5000, trainingMinutes: 0, intensity: 'low', estimatedActivityKcal: 0 },
  { key: 'gym', name: 'Gym day', type: 'gym', steps: 8000, trainingMinutes: 75, intensity: 'moderate', estimatedActivityKcal: 250 },
  { key: 'match', name: 'Match day', type: 'match', steps: 12000, trainingMinutes: 90, intensity: 'very_high', estimatedActivityKcal: 600 },
  { key: 'hike', name: 'Hiking day', type: 'hike', steps: 18000, trainingMinutes: 180, intensity: 'moderate', estimatedActivityKcal: 700 },
];

function toDateKey(dateInput: string | Date): string {
  return normalizeDateToLocal(dateInput);
}

function resolveWeightKg(log: Partial<DailyWeightActivityLog>): number | null {
  const value = Number((log.weightKg ?? log.weight) as number);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function resolveCalories(log: Partial<DailyWeightActivityLog>): number | null {
  if (Number.isFinite(log.calories as number) && Number(log.calories) > 0) {
    return Number(log.calories);
  }

  const protein = Number(log.proteinGrams ?? 0);
  const carbs = Number(log.carbsGrams ?? 0);
  const fat = Number(log.fatGrams ?? 0);
  const alcohol = Number(log.alcoholGrams ?? 0);

  const hasMacros = [protein, carbs, fat, alcohol].some((value) => Number.isFinite(value) && value > 0);
  if (!hasMacros) return null;

  return protein * 4 + carbs * 4 + fat * 9 + alcohol * 7;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function clampConfidenceScore(score: number): ConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function roundToNearestFive(value: number): number {
  return Math.round(value / 5) * 5;
}

export function calculateCaloriesFromMacros(log: Partial<DailyWeightActivityLog>): number | null {
  return resolveCalories(log);
}

export function calculateFormulaBMR(profile: WeightProfile): number {
  const weight = Number(profile.weightKg);
  const height = Number(profile.heightCm);
  const age = Number(profile.age);

  if (Number.isFinite(profile.bodyFatPercent ?? NaN)) {
    const leanMass = weight * (1 - Number(profile.bodyFatPercent) / 100);
    return 370 + 21.6 * leanMass;
  }

  return profile.sex === 'male'
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;
}

export function calculateFormulaTDEE(profile: WeightProfile): number {
  const multipliers: Record<ActivityLevel, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  return calculateFormulaBMR(profile) * multipliers[profile.activityLevel];
}

export function getValidCalorieLogs(logs: DailyWeightActivityLog[]): DailyWeightActivityLog[] {
  return logs.filter((log) => {
    if (log.excludeFromAdaptiveTDEE) return false;
    const calories = resolveCalories(log);
    return calories !== null && !log.isCalorieOutlier;
  });
}

export function getValidWeightLogs(logs: DailyWeightActivityLog[]): DailyWeightActivityLog[] {
  return logs.filter((log) => {
    if (log.excludeFromAdaptiveTDEE) return false;
    return resolveWeightKg(log) !== null && !log.isWeightOutlier;
  });
}

export function detectCalorieOutliers(logs: DailyWeightActivityLog[]): DailyWeightActivityLog[] {
  return logs.map((log) => {
    const calories = resolveCalories(log);
    if (calories === null) return { ...log, isCalorieOutlier: false };
    return {
      ...log,
      calories,
      isCalorieOutlier: calories < 800 || calories > 6000,
    };
  });
}

export function detectWeightOutliers(logs: DailyWeightActivityLog[]): DailyWeightActivityLog[] {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const flagged: DailyWeightActivityLog[] = [];

  sorted.forEach((log, index) => {
    const weight = resolveWeightKg(log);
    if (weight === null) {
      flagged.push({ ...log, isWeightOutlier: false, weightKg: null });
      return;
    }

    const previousWeights = flagged
      .slice(0, index)
      .filter((entry) => !entry.isWeightOutlier)
      .map((entry) => resolveWeightKg(entry))
      .filter((value): value is number => value !== null);

    const previousValid = previousWeights.length > 0 ? previousWeights[previousWeights.length - 1] : null;
    const localWindow = previousWeights.slice(-7);
    const localAverage = localWindow.length >= 3 ? mean(localWindow) : null;
    const deltaFromPrevious = previousValid === null ? 0 : Math.abs(weight - previousValid);
    const deltaFromTrend = localAverage === null ? 0 : Math.abs(weight - localAverage);
    const isOutlier = deltaFromPrevious > 2.75 || (localAverage !== null && deltaFromTrend > 2.5);

    flagged.push({
      ...log,
      weightKg: weight,
      isWeightOutlier: isOutlier,
    });
  });

  return flagged;
}

export function calculateMovingAverageTrend(
  logs: DailyWeightActivityLog[],
  windowDays = 7
): DailyWeightActivityLog[] {
  const sorted = [...logs]
    .map((log) => ({ ...log, date: toDateKey(log.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((log, index) => {
    const windowStart = subDays(parseISO(log.date), windowDays - 1);
    const window = sorted
      .slice(0, index + 1)
      .filter((candidate) => {
        if (candidate.isWeightOutlier || candidate.excludeFromAdaptiveTDEE) return false;
        const candidateDate = parseLocalDateInput(candidate.date);
        const candidateWeight = resolveWeightKg(candidate);
        return candidateDate !== null && candidateWeight !== null && candidateDate >= windowStart;
      });

    if (window.length < 3) {
      return { ...log, trendWeightKg: null };
    }

    const averageWeight = mean(window.map((entry) => resolveWeightKg(entry) as number));
    return { ...log, trendWeightKg: averageWeight };
  });
}

export function calculateEWMATrend(
  logs: DailyWeightActivityLog[],
  alpha = 0.25
): DailyWeightActivityLog[] {
  const sorted = [...logs]
    .map((log) => ({ ...log, date: toDateKey(log.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let previousTrend: number | null = null;

  return sorted.map((log) => {
    const weight = resolveWeightKg(log);
    if (weight === null || log.isWeightOutlier || log.excludeFromAdaptiveTDEE) {
      return { ...log, trendWeightKg: null };
    }

    const trend = previousTrend === null ? weight : alpha * weight + (1 - alpha) * previousTrend;
    previousTrend = trend;
    return { ...log, trendWeightKg: trend };
  });
}

export function calculateLinearRegressionSlope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;

  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumX2 = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function buildWindowLogs(
  logs: DailyWeightActivityLog[],
  windowDays: number,
  referenceDate: Date
): DailyWeightActivityLog[] {
  const end = startOfDay(referenceDate);
  const start = startOfDay(subDays(end, windowDays - 1));

  return logs.filter((log) => {
    const parsed = parseLocalDateInput(log.date);
    return parsed !== null && parsed >= start && parsed <= end;
  });
}

function findAdaptiveSeries(logs: DailyWeightActivityLog[]): DailyWeightActivityLog[] {
  const movingAverage = calculateMovingAverageTrend(logs, 7);
  const movingAveragePoints = movingAverage.filter((log) => log.trendWeightKg !== null);

  if (movingAveragePoints.length >= 5) {
    return movingAverage;
  }

  return calculateEWMATrend(logs, 0.25);
}

function buildTrendSlope(series: DailyWeightActivityLog[]): number {
  const ordered = series
    .filter((log) => !log.isWeightOutlier && !log.excludeFromAdaptiveTDEE)
    .map((log) => ({
      date: log.date,
      trendWeightKg: log.trendWeightKg,
    }))
    .filter((entry): entry is { date: string; trendWeightKg: number } => entry.trendWeightKg !== null);

  if (ordered.length < 2) return 0;

  const firstDate = parseLocalDateInput(ordered[0].date);
  if (!firstDate) return 0;

  const points = ordered.map((entry) => {
    const parsed = parseLocalDateInput(entry.date);
    return {
      x: parsed ? differenceInCalendarDays(parsed, firstDate) : 0,
      y: entry.trendWeightKg,
    };
  });

  return calculateLinearRegressionSlope(points);
}

export function calculateConfidence(input: {
  calorieCoverage: number;
  weightEntriesCount: number;
  dataSpanDays: number;
  outlierDaysCount: number;
  calorieDaysCount: number;
  weightSlopeKgPerDay: number;
  calorieValues: number[];
}): { score: number; level: ConfidenceLevel } {
  const {
    calorieCoverage,
    weightEntriesCount,
    dataSpanDays,
    outlierDaysCount,
    calorieValues,
  } = input;

  let score = 0;

  if (calorieCoverage >= 0.85) score += 30;
  else if (calorieCoverage >= 0.7) score += 15;

  if (weightEntriesCount >= 20) score += 30;
  else if (weightEntriesCount >= 10) score += 15;

  if (dataSpanDays >= 28) score += 20;
  else if (dataSpanDays >= 14) score += 10;

  if (outlierDaysCount <= Math.max(1, Math.floor(calorieCoverage * 4))) score += 10;

  const calorieStd = standardDeviation(calorieValues);
  if (calorieValues.length >= 7 && calorieStd >= 150 && calorieStd <= 1200) {
    score += 10;
  }

  return {
    score,
    level: clampConfidenceScore(score),
  };
}

export function calculateTDEERange(tdee: number | null, confidence: ConfidenceLevel): {
  lowerBound: number | null;
  upperBound: number | null;
  margin: number | null;
} {
  if (tdee === null || confidence === 'insufficient_data') {
    return { lowerBound: null, upperBound: null, margin: null };
  }

  const margin = confidence === 'high' ? 125 : confidence === 'medium' ? 200 : 325;
  return {
    lowerBound: roundToNearestFive(tdee - margin),
    upperBound: roundToNearestFive(tdee + margin),
    margin,
  };
}

export function calculateAdaptiveTDEE(
  logs: DailyWeightActivityLog[],
  windowDays: number,
  referenceDate: Date = new Date()
): AdaptiveTDEEEstimate {
  const windowLogs = buildWindowLogs(logs, windowDays, referenceDate);
  const calorieLogs = getValidCalorieLogs(windowLogs);
  const weightLogs = getValidWeightLogs(windowLogs);
  const outlierDaysCount = windowLogs.filter((log) => log.isCalorieOutlier || log.isWeightOutlier).length;
  const calorieValues = calorieLogs.map((log) => resolveCalories(log) as number).filter((value): value is number => Number.isFinite(value));
  const avgCalories = calorieValues.length > 0 ? mean(calorieValues) : null;
  const calorieDaysCount = calorieLogs.length;
  const weightEntriesCount = weightLogs.length;
  const activityTaggedDaysCount = windowLogs.filter((log) => {
    return Boolean(log.activityTemplateId || log.steps || log.trainingMinutes || log.intensity || log.notes);
  }).length;
  const calorieCoverage = windowDays > 0 ? calorieDaysCount / windowDays : 0;
  const weightCoverage = windowDays > 0 ? weightEntriesCount / windowDays : 0;
  const activityCoverage = windowDays > 0 ? activityTaggedDaysCount / windowDays : 0;
  const sortedDates = windowLogs
    .map((log) => parseLocalDateInput(log.date))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const dataSpanDays = sortedDates.length > 0
    ? differenceInCalendarDays(sortedDates[sortedDates.length - 1], sortedDates[0]) + 1
    : 0;

  const trendSource = findAdaptiveSeries(windowLogs);
  const trendSlope = buildTrendSlope(trendSource);
  const weeklyWeightChangeKg = trendSlope * 7;
  const estimatedDailyEnergyBalance = trendSlope * 7700;
  const adaptiveTDEE = avgCalories === null ? null : avgCalories - estimatedDailyEnergyBalance;
  const canEstimate =
    calorieDaysCount >= Math.max(21, Math.ceil(windowDays * 0.75)) &&
    weightEntriesCount >= Math.max(10, Math.round(windowDays * 0.35)) &&
    dataSpanDays >= 14 &&
    calorieCoverage >= 0.75;

  const confidence = canEstimate
    ? calculateConfidence({
        calorieCoverage,
        weightEntriesCount,
        dataSpanDays,
        outlierDaysCount,
        calorieDaysCount,
        weightSlopeKgPerDay: trendSlope,
        calorieValues,
      })
    : { score: 0, level: 'insufficient_data' as ConfidenceLevel };

  const tdeeRange = calculateTDEERange(adaptiveTDEE, confidence.level);
  const missingCalorieDaysNeeded = Math.max(0, Math.max(21, Math.ceil(windowDays * 0.75)) - calorieDaysCount);
  const missingWeightEntriesNeeded = Math.max(0, Math.max(10, Math.round(windowDays * 0.35)) - weightEntriesCount);
  const notes: string[] = [];

  if (!canEstimate) {
    notes.push('Not enough data yet for a reliable adaptive TDEE');
  }

  if (outlierDaysCount > 0) {
    notes.push(`${outlierDaysCount} suspicious day${outlierDaysCount === 1 ? '' : 's'} detected`);
  }

  return {
    windowDays,
    method: 'adaptive',
    formulaTDEE: null,
    adaptiveTDEE: canEstimate && adaptiveTDEE !== null ? roundToNearestFive(adaptiveTDEE) : null,
    finalTDEE: canEstimate && adaptiveTDEE !== null ? roundToNearestFive(adaptiveTDEE) : null,
    lowerBound: tdeeRange.lowerBound,
    upperBound: tdeeRange.upperBound,
    avgCalories,
    weightSlopeKgPerDay: trendSlope,
    weeklyWeightChangeKg,
    estimatedDailyEnergyBalance,
    calorieDaysCount,
    weightEntriesCount,
    activityTaggedDaysCount,
    calorieCoverage,
    weightCoverage,
    activityCoverage,
    outlierDaysCount,
    confidence: confidence.level,
    score: confidence.score,
    dataSpanDays,
    missingCalorieDaysNeeded,
    missingWeightEntriesNeeded,
    notes,
    trendSeries: trendSource.map((log) => ({
      date: log.date,
      weightKg: resolveWeightKg(log),
      trendWeightKg: log.trendWeightKg,
    })),
  };
}

export function calculateFinalAdaptiveTDEE(estimates: AdaptiveTDEEEstimate[]): number | null {
  const valid = estimates.filter((estimate) => estimate.finalTDEE !== null && estimate.confidence !== 'insufficient_data');
  const byWindow = new Map(valid.map((estimate) => [estimate.windowDays, estimate.finalTDEE as number]));

  const tdee28 = byWindow.get(28) ?? null;
  const tdee56 = byWindow.get(56) ?? null;
  const tdee90 = byWindow.get(90) ?? null;

  if (tdee28 === null) return null;
  if (tdee56 === null && tdee90 === null) return roundToNearestFive(tdee28);
  if (tdee56 !== null && tdee90 === null) {
    return roundToNearestFive(0.7 * tdee28 + 0.3 * tdee56);
  }
  if (tdee56 !== null && tdee90 !== null) {
    return roundToNearestFive(0.6 * tdee28 + 0.3 * tdee56 + 0.1 * tdee90);
  }

  return roundToNearestFive(tdee28);
}

export function calculateTemplateTDEEEstimates(
  templates: ActivityDayTemplate[],
  logs: DailyWeightActivityLog[],
  finalAdaptiveTDEE: number | null,
  referenceDate: Date = new Date()
): TemplateTDEEEstimate[] {
  const windowStart = startOfDay(subDays(startOfDay(referenceDate), 27));
  const windowEnd = startOfDay(referenceDate);
  const recentLogs = logs.filter((log) => {
    const parsed = parseLocalDateInput(log.date);
    return parsed !== null && parsed >= windowStart && parsed <= windowEnd;
  });

  const averageTemplateActivityKcal = mean(
    recentLogs
      .map((log) => templates.find((template) => template.id === log.activityTemplateId)?.estimatedActivityKcal ?? null)
      .filter((value): value is number => value !== null)
  );

  return templates.map((template) => {
    const sampleDays = recentLogs.filter((log) => log.activityTemplateId === template.id).length;
    const estimatedActivityKcal = Number(template.estimatedActivityKcal ?? 0);
    const estimatedTemplateTDEE =
      finalAdaptiveTDEE === null
        ? null
        : roundToNearestFive(finalAdaptiveTDEE + estimatedActivityKcal - averageTemplateActivityKcal);

    let confidence: ConfidenceLevel = 'low';
    if (sampleDays >= 10) confidence = 'medium';
    if (sampleDays >= 15) confidence = 'high';
    if (!template.isDefault && sampleDays < 8) confidence = 'low';
    if (sampleDays === 0) confidence = 'insufficient_data';

    return {
      templateId: template.id,
      templateName: template.name,
      templateType: template.type,
      userId: template.userId,
      baseTDEE: finalAdaptiveTDEE,
      estimatedTemplateTDEE,
      estimatedActivityKcal,
      learnedOffsetKcal: template.learnedOffsetKcal ?? null,
      sampleDays,
      confidence,
      calculatedAt: new Date().toISOString(),
    };
  });
}

export function buildDailyIntakeFromMeals(meals: Meal[], foods: Food[]): WeightHubDailyIntake[] {
  const grouped = new Map<string, WeightHubDailyIntake>();

  meals.forEach((meal) => {
    const dateKey = normalizeDateToLocal(meal.created_at ?? meal.time);
    if (!dateKey) return;

    const mealItems = (meal.items || []).map((item) => ({
      food: item.foodId ? getFoodOrUnknown(foods, item.foodId) : undefined,
      quantity: item.quantityGrams,
      customMacros: item,
    }));
    const totals = calculateMealTotals(mealItems);
    const existing = grouped.get(dateKey) ?? {
      date: dateKey,
      calories: 0,
      proteinGrams: 0,
      carbsGrams: 0,
      fatGrams: 0,
      alcoholGrams: 0,
      mealCount: 0,
    };

    grouped.set(dateKey, {
      date: dateKey,
      calories: (existing.calories ?? 0) + totals.calories,
      proteinGrams: (existing.proteinGrams ?? 0) + totals.protein,
      carbsGrams: (existing.carbsGrams ?? 0) + totals.carbs,
      fatGrams: (existing.fatGrams ?? 0) + totals.fat,
      alcoholGrams: existing.alcoholGrams ?? 0,
      mealCount: existing.mealCount + 1,
    });
  });

  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildWeightHubSeries(
  logs: DailyWeightActivityLog[],
  intake: WeightHubDailyIntake[],
  templates: ActivityDayTemplate[],
  startDate: Date,
  endDate: Date
): WeightHubSeriesPoint[] {
  const intakeByDate = new Map(intake.map((entry) => [entry.date, entry]));
  const templateById = new Map(templates.map((template) => [template.id, template]));

  return eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(endDate) }).map((day) => {
    const date = format(day, 'yyyy-MM-dd');
    const log = logs.find((entry) => normalizeDateToLocal(entry.date) === date);
    const dailyIntake = intakeByDate.get(date);
    const template = log?.activityTemplateId ? templateById.get(log.activityTemplateId) : null;
    const weightKg = resolveWeightKg(log ?? {});
    const calories = log?.calories ?? dailyIntake?.calories ?? null;

    return {
      date,
      weightKg,
      trendWeightKg: log?.trendWeightKg ?? null,
      calories,
      activityTemplateId: log?.activityTemplateId ?? null,
      steps: log?.steps ?? null,
      trainingMinutes: log?.trainingMinutes ?? null,
      intensity: log?.intensity ?? null,
      notes: log?.notes ?? null,
      isWeightOutlier: Boolean(log?.isWeightOutlier),
      isCalorieOutlier: Boolean(log?.isCalorieOutlier),
      excludeFromAdaptiveTDEE: Boolean(log?.excludeFromAdaptiveTDEE),
      templateEstimatedActivityKcal: template?.estimatedActivityKcal ?? null,
    };
  });
}

export function getDefaultActivityDayTemplates(userId: string): Array<Partial<ActivityDayTemplate> & { userId: string }> {
  return DEFAULT_TEMPLATE_KEYS.map((template) => ({
    userId,
    templateKey: template.key,
    name: template.name,
    type: template.type,
    defaultSteps: template.steps,
    defaultTrainingMinutes: template.trainingMinutes,
    defaultIntensity: template.intensity,
    estimatedActivityKcal: template.estimatedActivityKcal,
    learnedOffsetKcal: 0,
    confidence: 'insufficient_data' as ConfidenceLevel,
    includeInAdaptiveModel: true,
    isDefault: true,
  }));
}

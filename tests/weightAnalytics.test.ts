import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, format } from 'date-fns';
import { buildExportRows } from '../src/lib/statsUtils.ts';
import { normalizeDateToLocal } from '../src/lib/dateUtils.ts';
import { generateRangeSummaryText } from '../src/lib/exportUtils.ts';
import type { Food, Meal } from '../src/types.ts';
import {
  calculateAdaptiveTDEE,
  calculateFinalAdaptiveTDEE,
  calculateFormulaBMR,
  calculateFormulaTDEE,
  calculateTemplateTDEEEstimates,
  buildWeightChartSeries,
  detectWeightOutliers,
  resolveFormulaBodyFatPercent,
  type ActivityDayTemplate,
  type DailyWeightActivityLog,
  type WeightProfile,
} from '../src/lib/weightAnalytics.ts';
import {
  buildWeightExportSeries,
  buildWeightTableCsv,
  buildWeightTableFilename,
  buildWeightTableCsvFromInput,
  getWeightExportRange,
} from '../src/lib/weightExport.ts';

function buildLogs({
  startDate,
  days,
  weightStart,
  weightSlopePerDay,
  calories = 2500,
  missingCalorieDays = [],
  activityTemplateId = 'rest-template',
  addOutlier = false,
}: {
  startDate: Date;
  days: number;
  weightStart: number;
  weightSlopePerDay: number;
  calories?: number;
  missingCalorieDays?: number[];
  activityTemplateId?: string;
  addOutlier?: boolean;
}): DailyWeightActivityLog[] {
  const logs: DailyWeightActivityLog[] = [];

  for (let index = 0; index < days; index += 1) {
    const date = format(addDays(startDate, index), 'yyyy-MM-dd');
    const weight = weightStart + weightSlopePerDay * index;
    const isMissingCalorieDay = missingCalorieDays.includes(index);
    logs.push({
      date,
      weight,
      weightKg: weight,
      calories: isMissingCalorieDay ? null : calories,
      proteinGrams: isMissingCalorieDay ? null : 150,
      carbsGrams: isMissingCalorieDay ? null : 250,
      fatGrams: isMissingCalorieDay ? null : 70,
      alcoholGrams: isMissingCalorieDay ? null : 0,
      activityTemplateId,
      steps: 8000,
      trainingMinutes: 60,
      intensity: 'moderate',
      notes: '',
      isWeightOutlier: false,
      isCalorieOutlier: false,
      excludeFromAdaptiveTDEE: false,
    });
  }

  if (addOutlier && logs.length >= 15) {
    logs[14] = {
      ...logs[14],
      weight: logs[14].weight + 15,
      weightKg: logs[14].weightKg! + 15,
    };
  }

  return logs;
}

test('adaptive TDEE stays near intake when weight is stable', () => {
  const logs = buildLogs({
    startDate: new Date('2026-05-01T12:00:00'),
    days: 28,
    weightStart: 80,
    weightSlopePerDay: 0,
  });

  const estimate = calculateAdaptiveTDEE(logs, 28, new Date('2026-05-28T12:00:00'));

  assert.equal(estimate.confidence !== 'insufficient_data', true);
  assert.ok(estimate.finalTDEE !== null);
  assert.ok(Math.abs((estimate.finalTDEE ?? 0) - 2500) <= 10);
});

test('adaptive TDEE rises when weight is falling at the same intake', () => {
  const logs = buildLogs({
    startDate: new Date('2026-05-01T12:00:00'),
    days: 28,
    weightStart: 80,
    weightSlopePerDay: -0.03,
  });

  const estimate = calculateAdaptiveTDEE(logs, 28, new Date('2026-05-28T12:00:00'));

  assert.ok((estimate.finalTDEE ?? 0) > 2500);
});

test('adaptive TDEE falls when weight is rising at the same intake', () => {
  const logs = buildLogs({
    startDate: new Date('2026-05-01T12:00:00'),
    days: 28,
    weightStart: 80,
    weightSlopePerDay: 0.03,
  });

  const estimate = calculateAdaptiveTDEE(logs, 28, new Date('2026-05-28T12:00:00'));

  assert.ok((estimate.finalTDEE ?? 0) < 2500);
});

test('missing calorie days are not counted as zero', () => {
  const logs = buildLogs({
    startDate: new Date('2026-05-01T12:00:00'),
    days: 28,
    weightStart: 80,
    weightSlopePerDay: 0,
    missingCalorieDays: [2, 7, 11, 18, 24],
  });

  const estimate = calculateAdaptiveTDEE(logs, 28, new Date('2026-05-28T12:00:00'));

  assert.equal(estimate.confidence !== 'insufficient_data', true);
  assert.ok(estimate.avgCalories !== null);
  assert.ok(Math.abs((estimate.avgCalories ?? 0) - 2500) <= 1);
});

test('too few weight entries produces insufficient confidence', () => {
  const logs = buildLogs({
    startDate: new Date('2026-05-01T12:00:00'),
    days: 12,
    weightStart: 80,
    weightSlopePerDay: 0,
  }).map((log, index) => (index < 8 ? log : { ...log, weight: 0, weightKg: null }));

  const estimate = calculateAdaptiveTDEE(logs, 28, new Date('2026-05-28T12:00:00'));

  assert.ok(estimate.confidence === 'insufficient_data' || estimate.confidence === 'low');
});

test('weight outliers do not aggressively distort the trend', () => {
  const logs = buildLogs({
    startDate: new Date('2026-05-01T12:00:00'),
    days: 28,
    weightStart: 80,
    weightSlopePerDay: 0,
    addOutlier: true,
  });

  const flagged = detectWeightOutliers(logs);
  assert.equal(flagged.some((log) => log.isWeightOutlier), true);

  const estimate = calculateAdaptiveTDEE(flagged, 28, new Date('2026-05-28T12:00:00'));
  assert.ok(Math.abs((estimate.finalTDEE ?? 0) - 2500) <= 25);
});

test('classic formula-based TDEE matches Mifflin-St Jeor', () => {
  const profile: WeightProfile = {
    weightKg: 80,
    heightCm: 180,
    age: 30,
    sex: 'male',
    activityLevel: 'sedentary',
  };

  const bmr = calculateFormulaBMR(profile);
  const tdee = calculateFormulaTDEE(profile);

  assert.equal(Math.round(bmr), 1780);
  assert.equal(Math.round(tdee), 2136);
});

test('classic formula-based BMR uses Katch-McArdle when body fat percent is available', () => {
  const profile: WeightProfile = {
    weightKg: 80,
    heightCm: 180,
    age: 30,
    sex: 'male',
    bodyFatPercent: 20,
    activityLevel: 'sedentary',
  };

  const bmr = calculateFormulaBMR(profile);

  assert.equal(Math.round(bmr), 1752);
});

test('formula body fat source prioritizes latest body composition measurement over manual fallback', () => {
  const result = resolveFormulaBodyFatPercent(18.5, 22.0);

  assert.equal(result.bodyFatPercent, 18.5);
  assert.equal(result.source, 'latest body composition measurement');
});

test('formula body fat source falls back to manual input when latest measurement value is unavailable', () => {
  const result = resolveFormulaBodyFatPercent(null, 22.0);

  assert.equal(result.bodyFatPercent, 22.0);
  assert.equal(result.source, 'manual fallback');
});

test('formula body fat source is unavailable when neither measurement nor fallback exists', () => {
  const result = resolveFormulaBodyFatPercent(null, null);

  assert.equal(result.bodyFatPercent, null);
  assert.equal(result.source, 'unavailable');
});

test('template TDEE offsets from the adaptive base and average template activity', () => {
  const templates: ActivityDayTemplate[] = [
    {
      id: 'rest-template',
      userId: 'user-1',
      templateKey: 'rest',
      name: 'Rest day',
      type: 'rest',
      defaultSteps: 5000,
      defaultTrainingMinutes: 0,
      defaultIntensity: 'low',
      estimatedActivityKcal: 0,
      confidence: 'low',
      includeInAdaptiveModel: true,
      isDefault: true,
    },
    {
      id: 'match-template',
      userId: 'user-1',
      templateKey: 'match',
      name: 'Match day',
      type: 'match',
      defaultSteps: 12000,
      defaultTrainingMinutes: 90,
      defaultIntensity: 'very_high',
      estimatedActivityKcal: 600,
      confidence: 'low',
      includeInAdaptiveModel: true,
      isDefault: true,
    },
  ];

  const logs: DailyWeightActivityLog[] = [
    {
      date: '2026-05-26',
      weight: 80,
      weightKg: 80,
      calories: 2500,
      proteinGrams: 150,
      carbsGrams: 250,
      fatGrams: 70,
      alcoholGrams: 0,
      activityTemplateId: 'rest-template',
      steps: 5000,
      trainingMinutes: 0,
      intensity: 'low',
      notes: '',
      isWeightOutlier: false,
      isCalorieOutlier: false,
      excludeFromAdaptiveTDEE: false,
    },
    {
      date: '2026-05-27',
      weight: 80,
      weightKg: 80,
      calories: 2500,
      proteinGrams: 150,
      carbsGrams: 250,
      fatGrams: 70,
      alcoholGrams: 0,
      activityTemplateId: 'rest-template',
      steps: 5000,
      trainingMinutes: 0,
      intensity: 'low',
      notes: '',
      isWeightOutlier: false,
      isCalorieOutlier: false,
      excludeFromAdaptiveTDEE: false,
    },
    {
      date: '2026-05-28',
      weight: 80,
      weightKg: 80,
      calories: 2500,
      proteinGrams: 150,
      carbsGrams: 250,
      fatGrams: 70,
      alcoholGrams: 0,
      activityTemplateId: 'match-template',
      steps: 12000,
      trainingMinutes: 90,
      intensity: 'very_high',
      notes: '',
      isWeightOutlier: false,
      isCalorieOutlier: false,
      excludeFromAdaptiveTDEE: false,
    },
  ];

  const estimates = calculateTemplateTDEEEstimates(templates, logs, 2700, new Date('2026-05-28T12:00:00'));

  const rest = estimates.find((item) => item.templateId === 'rest-template');
  const match = estimates.find((item) => item.templateId === 'match-template');

  assert.equal(rest?.estimatedTemplateTDEE, 2500);
  assert.equal(match?.estimatedTemplateTDEE, 3100);
});

test('final adaptive TDEE blends available windows', () => {
  const estimate28 = { windowDays: 28, finalTDEE: 2800, confidence: 'medium' } as const;
  const estimate56 = { windowDays: 56, finalTDEE: 2600, confidence: 'medium' } as const;
  const estimate90 = { windowDays: 90, finalTDEE: 2500, confidence: 'medium' } as const;

  const blended = calculateFinalAdaptiveTDEE([estimate28 as never, estimate56 as never, estimate90 as never]);
  assert.equal(blended, 2710);
});

test('weight export range uses the selected period and filename matches the range', () => {
  const referenceDate = new Date('2026-05-24T12:00:00');
  const range30d = getWeightExportRange('30d', referenceDate);
  const rangeMonth = getWeightExportRange('month', referenceDate);

  assert.equal(normalizeDateToLocal(range30d.start), '2026-04-25');
  assert.equal(normalizeDateToLocal(range30d.end), '2026-05-24');
  assert.equal(buildWeightTableFilename(range30d), 'fibertrack-weight-table-2026-04-25-to-2026-05-24.csv');
  assert.equal(normalizeDateToLocal(rangeMonth.start), '2026-05-01');
  assert.equal(normalizeDateToLocal(rangeMonth.end), '2026-05-31');
  assert.equal(buildWeightTableFilename(rangeMonth), 'fibertrack-weight-table-2026-05-01-to-2026-05-31.csv');
});

test('weight chart series changes with the selected range', () => {
  const referenceDate = new Date('2026-05-28T12:00:00');
  const templates: ActivityDayTemplate[] = [];
  const dailyIntake: Parameters<typeof buildWeightChartSeries>[1] = [];
  const weightLogs: DailyWeightActivityLog[] = [
    ...Array.from({ length: 11 }, (_, index) => {
      const date = format(addDays(new Date('2026-01-01T12:00:00'), index * 2), 'yyyy-MM-dd');
      return {
        date,
        weight: 92,
        weightKg: 92,
        calories: null,
        activityTemplateId: null,
        steps: null,
        trainingMinutes: null,
        intensity: null,
        notes: null,
        isWeightOutlier: false,
        isCalorieOutlier: false,
        excludeFromAdaptiveTDEE: false,
      };
    }),
    ...Array.from({ length: 4 }, (_, index) => {
      const date = format(addDays(new Date('2026-05-20T12:00:00'), index * 2), 'yyyy-MM-dd');
      return {
        date,
        weight: 80 - index,
        weightKg: 80 - index,
        calories: null,
        activityTemplateId: null,
        steps: null,
        trainingMinutes: null,
        intensity: null,
        notes: null,
        isWeightOutlier: false,
        isCalorieOutlier: false,
        excludeFromAdaptiveTDEE: false,
      };
    }),
  ];

  const chart30d = buildWeightChartSeries(weightLogs, dailyIntake, templates, getWeightExportRange('30d', referenceDate).start, getWeightExportRange('30d', referenceDate).end);
  const chart6m = buildWeightChartSeries(weightLogs, dailyIntake, templates, getWeightExportRange('6m', referenceDate).start, getWeightExportRange('6m', referenceDate).end);

  assert.equal(chart30d.length, 30);
  assert.equal(chart6m.length, 180);
  assert.notEqual(chart30d[0].date, chart6m[0].date);

  const chart30dWeights = chart30d.filter((point) => point.weightKg !== null);
  const chart6mWeights = chart6m.filter((point) => point.weightKg !== null);

  assert.equal(chart30dWeights.length, 4);
  assert.equal(chart6mWeights.length, 15);
  assert.notEqual(chart30dWeights[0]?.date, chart6mWeights[0]?.date);

  const chart30dTrendValues = chart30d.filter((point) => point.trendWeightKg !== null).map((point) => point.trendWeightKg);
  const chart6mTrendValues = chart6m.filter((point) => point.trendWeightKg !== null).map((point) => point.trendWeightKg);

  assert.notEqual(chart30dTrendValues.length, chart6mTrendValues.length);

  const lastTrend30d = chart30dTrendValues.at(-1);
  const lastTrend6m = chart6mTrendValues.at(-1);

  assert.ok(lastTrend30d !== undefined);
  assert.ok(lastTrend6m !== undefined);
  assert.notEqual(lastTrend30d, lastTrend6m);
});

test('weight export csv only includes date, weight, and calories with blanks for missing values', () => {
  const referenceDate = new Date('2026-05-24T12:00:00');
  const templates: ActivityDayTemplate[] = [];
  const weightLogs: DailyWeightActivityLog[] = [
    {
      date: '2026-05-10',
      weight: 79.9,
      weightKg: 79.9,
      calories: null,
      activityTemplateId: null,
      steps: null,
      trainingMinutes: null,
      intensity: null,
      notes: null,
      isWeightOutlier: false,
      isCalorieOutlier: false,
      excludeFromAdaptiveTDEE: false,
    },
    {
      date: '2026-05-12',
      weight: 80.2,
      weightKg: 80.2,
      calories: null,
      activityTemplateId: null,
      steps: null,
      trainingMinutes: null,
      intensity: null,
      notes: null,
      isWeightOutlier: false,
      isCalorieOutlier: false,
      excludeFromAdaptiveTDEE: false,
    },
  ];
  const dailyIntake = [
    { date: '2026-05-11', calories: 2100, proteinGrams: 0, carbsGrams: 0, fatGrams: 0, alcoholGrams: 0, mealCount: 1 },
  ];

  const series = buildWeightExportSeries(weightLogs, dailyIntake, templates, '30d', referenceDate);
  const csv = buildWeightTableCsv(series);
  const lines = csv.split('\n');

  assert.equal(lines[0], 'Date,Weight,Calories');
  assert.equal(lines.length, 31);
  assert.ok(lines.some((line) => line === '2026-05-10,79.9,'));
  assert.ok(lines.some((line) => line === '2026-05-11,,2100'));
  assert.ok(lines.some((line) => line === '2026-05-12,80.2,'));
  assert.ok(!csv.includes('2026-05-11,,0'));
  assert.ok(!csv.includes('Adaptive TDEE'));
  assert.ok(!csv.includes('Formula TDEE'));
  assert.ok(!csv.includes('Body composition'));
  assert.ok(!csv.includes('Activity templates'));
  assert.ok(!csv.includes('Model details'));
});

test('weight export header is exactly Date,Weight,Calories', () => {
  const csv = buildWeightTableCsvFromInput({
    weightLogs: [],
    meals: [],
    foods: [],
    range: {
      start: new Date('2026-05-10T00:00:00'),
      end: new Date('2026-05-10T23:59:59'),
    },
  });

  const [header] = csv.split('\n');
  assert.equal(header, 'Date,Weight,Calories');
});

test('missing weight exports as blank', () => {
  const csv = buildWeightTableCsvFromInput({
    weightLogs: [
      {
        date: '2026-05-10',
        weight: 79.9,
        weightKg: 79.9,
        calories: null,
        activityTemplateId: null,
        steps: null,
        trainingMinutes: null,
        intensity: null,
        notes: null,
        isWeightOutlier: false,
        isCalorieOutlier: false,
        excludeFromAdaptiveTDEE: false,
      },
    ],
    meals: [
      {
        id: 'meal-1',
        name: 'Lunch',
        time: '12:00',
        created_at: '2026-05-11T12:00:00Z',
        items: [
          {
            foodId: 'food-1',
            quantityGrams: 100,
          },
        ],
      },
    ],
    foods: [
      {
        id: 'food-1',
        name_hu: 'Yogurt',
        calories: 100,
        carbs: 10,
        protein: 5,
        fat: 3,
        sugar: 8,
        saturated_fat: 1,
        soluble_fiber: 0,
        insoluble_fiber: 0,
        total_fiber: 0,
        source: 'sheets',
      },
    ],
    range: {
      start: new Date('2026-05-10T00:00:00'),
      end: new Date('2026-05-11T23:59:59'),
    },
  });

  const lines = csv.split('\n');
  assert.equal(lines[2], '2026-05-11,,100');
});

test('missing calories exports as blank', () => {
  const csv = buildWeightTableCsvFromInput({
    weightLogs: [
      {
        date: '2026-05-10',
        weight: 79.9,
        weightKg: 79.9,
        calories: null,
        activityTemplateId: null,
        steps: null,
        trainingMinutes: null,
        intensity: null,
        notes: null,
        isWeightOutlier: false,
        isCalorieOutlier: false,
        excludeFromAdaptiveTDEE: false,
      },
    ],
    meals: [],
    foods: [],
    range: {
      start: new Date('2026-05-10T00:00:00'),
      end: new Date('2026-05-10T23:59:59'),
    },
  });

  const lines = csv.split('\n');
  assert.equal(lines[1], '2026-05-10,79.9,');
});

test('selected local date range drives the exported rows', () => {
  const csv = buildWeightTableCsvFromInput({
    weightLogs: [
      {
        date: '2026-05-11',
        weight: 80.1,
        weightKg: 80.1,
        calories: 2200,
        activityTemplateId: null,
        steps: null,
        trainingMinutes: null,
        intensity: null,
        notes: null,
        isWeightOutlier: false,
        isCalorieOutlier: false,
        excludeFromAdaptiveTDEE: false,
      },
    ],
    meals: [],
    foods: [],
    range: {
      start: new Date('2026-05-10T00:00:00'),
      end: new Date('2026-05-12T23:59:59'),
    },
  });

  const lines = csv.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1].startsWith('2026-05-10,'), true);
  assert.equal(lines[2].startsWith('2026-05-11,'), true);
  assert.equal(lines[3].startsWith('2026-05-12,'), true);
});

test('nutrition export still works', () => {
  const foods: Food[] = [{
    id: 'food-1',
    name_hu: 'Oatmeal',
    calories: 100,
    carbs: 15,
    protein: 4,
    fat: 2,
    sugar: 1,
    saturated_fat: 0.5,
    soluble_fiber: 1,
    insoluble_fiber: 2,
    total_fiber: 3,
    source: 'sheets',
  }];

  const meals: Meal[] = [{
    id: 'meal-1',
    name: 'Breakfast',
    time: '08:00',
    created_at: '2026-05-11T08:00:00Z',
    items: [
      {
        foodId: 'food-1',
        quantityGrams: 50,
      },
    ],
  }];

  const rows = buildExportRows(meals, foods);
  const summary = generateRangeSummaryText(meals, foods, { start: '2026-05-11', end: '2026-05-11' });

  assert.equal(rows[0].join(','), 'Date,Time,Meal,Food,Quantity(g),Fiber,Sugar,Saturated fat,GL,Calories,Protein,Carbs,Fat');
  assert.equal(rows.length, 2);
  assert.match(summary, /FiberTrack Export: 2026-05-11 to 2026-05-11/);
  assert.match(summary, /08:00 Breakfast/);
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download } from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, endOfDay, endOfMonth, format, startOfMonth, subDays } from 'date-fns';
import { User } from '@supabase/supabase-js';
import { Food, Meal } from '../types';
import { cn } from '../lib/utils';
import { normalizeDateToLocal } from '../lib/dateUtils';
import {
  buildWeightExportSeries,
  buildWeightTableCsv,
  buildWeightTableFilename,
  getWeightExportRange,
  WEIGHT_EXPORT_PERIOD_OPTIONS,
  type WeightExportPeriod,
} from '../lib/weightExport';
import {
  buildDailyIntakeFromMeals,
  buildWeightHubSeries,
  calculateAdaptiveTDEE,
  calculateEWMATrend,
  calculateFinalAdaptiveTDEE,
  calculateFormulaBMR,
  calculateFormulaTDEE,
  calculateMovingAverageTrend,
  calculateTDEERange,
  calculateTemplateTDEEEstimates,
  getDefaultActivityDayTemplates,
  resolveFormulaBodyFatPercent,
  type ActivityDayTemplate,
  type ActivityIntensity,
  type ActivityLevel,
  type ConfidenceLevel,
  type DailyWeightActivityLog,
  type Sex,
  type WeightHubSeriesPoint,
  type WeightProfile,
} from '../lib/weightAnalytics';
import {
  useActivityDayTemplates,
  useDeleteActivityDayTemplate,
  useUpsertActivityDayTemplate,
  useUpsertDailyWeightActivityLog,
  useWeightLogs,
} from '../lib/queries/weightQueries';
import {
  useBowelMovements,
  useDeleteBowelMovement,
  useUpsertBowelMovement,
} from '../lib/queries/bowelMovementQueries';
import { formatBowelMovementDate, formatBowelMovementTime, type BowelMovement } from '../lib/bowelMovements';
import type { BodyCompositionMeasurement } from '../lib/bodyComposition';
import { toNullableNumber } from '../lib/bodyComposition';
import {
  useBodyCompositionMeasurements,
  useDeleteBodyCompositionMeasurement,
  useUpsertBodyCompositionMeasurement,
} from '../lib/queries/bodyCompositionQueries';

interface WeightViewProps {
  userId: string;
  selectedDate: Date;
  meals: Meal[];
  foods: Food[];
  onOpenExportModal?: (preset: 'today' | 'this_week' | 'last_7_days' | 'last_30_days' | 'custom_range', options?: { dataType?: 'nutrition' | 'weight' | 'bowel_movements'; formatType?: 'csv' | 'text' | 'pdf' }) => void;
}

type TemplateMode = 'rest' | 'gym' | 'match' | 'hike' | 'custom';

interface WeightProfileState {
  weightKg: number | null;
  heightCm: number;
  age: number;
  sex: Sex;
  bodyFatPercent: number | null;
  activityLevel: ActivityLevel;
}

interface WeightDraftState {
  weight: string;
  templateMode: TemplateMode;
  templateId: string | null;
  steps: string;
  trainingMinutes: string;
  intensity: ActivityIntensity;
  notes: string;
}

interface TemplateDraftState {
  id?: string;
  templateKey: string | null;
  name: string;
  type: ActivityDayTemplate['type'];
  defaultSteps: string;
  defaultTrainingMinutes: string;
  defaultIntensity: ActivityIntensity;
  estimatedActivityKcal: string;
  includeInAdaptiveModel: boolean;
  isDefault: boolean;
}

interface BodyCompositionDraftState {
  id?: string;
  measuredAt: string;
  source: string;
  weightKg: string;
  bodyFatPercent: string;
  bodyFatMassKg: string;
  skeletalMuscleMassKg: string;
  basalMetabolicRateKcal: string;
  visceralFatLevel: string;
  ecwRatio: string;
  bodyCellMassKg: string;
  notes: string;
}

interface BowelMovementDraftState {
  id?: string;
  date: string;
  time: string;
  notes: string;
}

const PROFILE_STORAGE_KEY = 'fibertrack_weight_profile_v1';
const BODY_COMPOSITION_MEASUREMENT_SOURCE_DEFAULT = 'InBody';

const DEFAULT_PROFILE: WeightProfileState = {
  weightKg: null,
  heightCm: 175,
  age: 30,
  sex: 'male',
  bodyFatPercent: null,
  activityLevel: 'moderate',
};

function createBodyCompositionDraft(measurement?: BodyCompositionMeasurement | null): BodyCompositionDraftState {
  return {
    id: measurement?.id,
    measuredAt: measurement?.measuredAt ?? normalizeDateToLocal(new Date()),
    source: measurement?.source ?? BODY_COMPOSITION_MEASUREMENT_SOURCE_DEFAULT,
    weightKg: measurement?.weightKg?.toString() ?? '',
    bodyFatPercent: measurement?.bodyFatPercent?.toString() ?? '',
    bodyFatMassKg: measurement?.bodyFatMassKg?.toString() ?? '',
    skeletalMuscleMassKg: measurement?.skeletalMuscleMassKg?.toString() ?? '',
    basalMetabolicRateKcal: measurement?.basalMetabolicRateKcal?.toString() ?? '',
    visceralFatLevel: measurement?.visceralFatLevel?.toString() ?? '',
    ecwRatio: measurement?.ecwRatio?.toString() ?? '',
    bodyCellMassKg: measurement?.bodyCellMassKg?.toString() ?? '',
    notes: measurement?.notes ?? '',
  };
}

function createBowelMovementDraft(entry?: BowelMovement | null): BowelMovementDraftState {
  const sourceDate = entry?.occurredAt ? new Date(entry.occurredAt) : new Date();
  return {
    id: entry?.id,
    date: format(sourceDate, 'yyyy-MM-dd'),
    time: format(sourceDate, 'HH:mm'),
    notes: entry?.notes ?? '',
  };
}

function loadProfile(): WeightProfileState {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;

  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as Partial<WeightProfileState>;
    return {
      weightKg: Number.isFinite(parsed.weightKg ?? NaN) ? Number(parsed.weightKg) : null,
      heightCm: Number.isFinite(parsed.heightCm ?? NaN) ? Number(parsed.heightCm) : DEFAULT_PROFILE.heightCm,
      age: Number.isFinite(parsed.age ?? NaN) ? Number(parsed.age) : DEFAULT_PROFILE.age,
      sex: parsed.sex === 'female' ? 'female' : 'male',
      bodyFatPercent: Number.isFinite(parsed.bodyFatPercent ?? NaN) ? Number(parsed.bodyFatPercent) : null,
      activityLevel:
        parsed.activityLevel === 'sedentary' ||
        parsed.activityLevel === 'light' ||
        parsed.activityLevel === 'moderate' ||
        parsed.activityLevel === 'active' ||
        parsed.activityLevel === 'very_active'
          ? parsed.activityLevel
          : DEFAULT_PROFILE.activityLevel,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function toProfilePayload(profile: WeightProfileState, weightKg: number | null): WeightProfile {
  return {
    weightKg: weightKg ?? profile.weightKg ?? 0,
    heightCm: profile.heightCm,
    age: profile.age,
    sex: profile.sex,
    bodyFatPercent: profile.bodyFatPercent,
    activityLevel: profile.activityLevel,
  };
}

function confidenceTone(confidence: ConfidenceLevel) {
  switch (confidence) {
    case 'high':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'medium':
      return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'low':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-100';
  }
}

function confidenceLabel(confidence: ConfidenceLevel) {
  switch (confidence) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Insufficient data';
  }
}

function formatKcal(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value)} kcal`;
}

function formatKcalPerDay(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value)} kcal/day`;
}

function formatKg(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} kg`;
}

function formatKgPerWeek(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} kg/week`;
}

function formatKcalRangePerDay(lowerBound: number | null, upperBound: number | null) {
  if (lowerBound === null || upperBound === null || !Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    return '—';
  }

  return `${Math.round(lowerBound)} - ${Math.round(upperBound)} kcal/day`;
}

function formatFloat(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`;
}

function formatPercentValue(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
}

function formatDateLabel(value: string) {
  return format(new Date(`${value}T00:00:00`), 'MMM d, yyyy');
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toDailyLog(point: WeightHubSeriesPoint): DailyWeightActivityLog {
  return {
    date: point.date,
    weight: Number(point.weightKg ?? 0),
    weightKg: point.weightKg ?? null,
    calories: point.calories ?? null,
    activityTemplateId: point.activityTemplateId ?? null,
    steps: point.steps ?? null,
    trainingMinutes: point.trainingMinutes ?? null,
    intensity: point.intensity ?? null,
    notes: point.notes ?? null,
    trendWeightKg: point.trendWeightKg ?? null,
    isWeightOutlier: point.isWeightOutlier,
    isCalorieOutlier: point.isCalorieOutlier,
    excludeFromAdaptiveTDEE: point.excludeFromAdaptiveTDEE,
  };
}

function getLatestNonNullWeight(series: WeightHubSeriesPoint[]) {
  const point = [...series].reverse().find((entry) => Number.isFinite(entry.weightKg ?? NaN));
  return point?.weightKg ?? null;
}

function getValueDaysAgo(series: WeightHubSeriesPoint[], daysAgo: number) {
  const targetDate = normalizeDateToLocal(subDays(new Date(), daysAgo));
  const point = [...series].reverse().find((entry) => entry.date <= targetDate && Number.isFinite(entry.weightKg ?? NaN));
  return point?.weightKg ?? null;
}

function getTemplateDefaults(template: ActivityDayTemplate | undefined) {
  return {
    steps: template?.defaultSteps?.toString() ?? '',
    trainingMinutes: template?.defaultTrainingMinutes?.toString() ?? '',
    intensity: template?.defaultIntensity ?? 'low',
  };
}

function getTemplateMode(template: ActivityDayTemplate | null): TemplateMode {
  if (!template) return 'rest';
  if (template.isDefault) return template.type as TemplateMode;
  return 'custom';
}

function buildTemplateDraft(template: ActivityDayTemplate): TemplateDraftState {
  return {
    id: template.id,
    templateKey: template.templateKey ?? null,
    name: template.name,
    type: template.type,
    defaultSteps: template.defaultSteps?.toString() ?? '',
    defaultTrainingMinutes: template.defaultTrainingMinutes?.toString() ?? '',
    defaultIntensity: template.defaultIntensity ?? 'low',
    estimatedActivityKcal: Number(template.estimatedActivityKcal ?? 0).toString(),
    includeInAdaptiveModel: template.includeInAdaptiveModel,
    isDefault: template.isDefault,
  };
}

function areTemplateDraftsEqual(a: WeightDraftState, b: WeightDraftState) {
  return (
    a.weight === b.weight &&
    a.templateMode === b.templateMode &&
    a.templateId === b.templateId &&
    a.steps === b.steps &&
    a.trainingMinutes === b.trainingMinutes &&
    a.intensity === b.intensity &&
    a.notes === b.notes
  );
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let frame = 0;
    const updateSize = () => {
      frame = window.requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const nextSize = {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };

        setSize((current) =>
          current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
        );
      });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener('resize', updateSize);
      };
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return [ref, size] as const;
}

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-border rounded-[2rem] shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-lg sm:text-xl font-black tracking-tight text-ink">{title}</h3>
          {subtitle ? <p className="text-sm text-subtle mt-1">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-gray-50/80 px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-subtle">{label}</div>
      <div className="mt-1 text-sm font-black text-ink">
        {value}
        {suffix ? <span className="ml-1 text-subtle">{suffix}</span> : null}
      </div>
    </div>
  );
}

function MiniBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-widest', tone)}>{label}</span>;
}

function TemplateRow({
  template,
  estimate,
  onEdit,
  onDelete,
}: {
  template: ActivityDayTemplate;
  estimate: ReturnType<typeof calculateTemplateTDEEEstimates>[number] | undefined;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-black text-ink truncate">{template.name}</div>
          <MiniBadge label={template.isDefault ? 'Default' : 'Custom'} tone={template.isDefault ? 'bg-slate-50 text-slate-600 border-slate-100' : 'bg-violet-50 text-violet-700 border-violet-100'} />
          <MiniBadge label={confidenceLabel(estimate?.confidence ?? template.confidence ?? 'low')} tone={confidenceTone(estimate?.confidence ?? template.confidence ?? 'low')} />
        </div>
        <div className="mt-1 text-xs font-semibold text-subtle">
          {template.defaultSteps ?? 0} steps · {template.defaultTrainingMinutes ?? 0} min · {template.defaultIntensity ?? 'low'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="rounded-2xl bg-gray-50 px-4 py-2 text-right">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-subtle">Approx. maintenance</div>
          <div className="text-sm font-black text-ink">{formatKcal(estimate?.estimatedTemplateTDEE)}</div>
        </div>
        <button onClick={onEdit} className="rounded-xl border border-border px-3 py-2 text-sm font-bold text-ink hover:bg-gray-50 transition-all">
          Edit
        </button>
        {onDelete ? (
          <button onClick={onDelete} className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 transition-all">
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function WeightView({ userId, meals, foods, onOpenExportModal }: WeightViewProps) {
  const today = useMemo(() => endOfDay(new Date()), []);
  const todayKey = normalizeDateToLocal(today);
  const monthStart = useMemo(() => startOfMonth(today), [today]);
  const monthEnd = useMemo(() => endOfMonth(today), [today]);
  const adaptiveStart = useMemo(() => subDays(today, 89), [today]);

  const { data: weightLogs = [] } = useWeightLogs(userId);
  const { data: templates = [] } = useActivityDayTemplates(userId);
  const { data: bodyCompositionMeasurements = [] } = useBodyCompositionMeasurements(userId);
  const { data: bowelMovements = [] } = useBowelMovements(userId);
  const saveLogMutation = useUpsertDailyWeightActivityLog();
  const saveTemplateMutation = useUpsertActivityDayTemplate();
  const deleteTemplateMutation = useDeleteActivityDayTemplate();
  const saveBodyCompositionMutation = useUpsertBodyCompositionMeasurement();
  const deleteBodyCompositionMutation = useDeleteBodyCompositionMeasurement();
  const saveBowelMovementMutation = useUpsertBowelMovement();
  const deleteBowelMovementMutation = useDeleteBowelMovement();

  const [profile, setProfile] = useState<WeightProfileState>(() => loadProfile());
  const [draft, setDraft] = useState<WeightDraftState>({
    weight: '',
    templateMode: 'rest',
    templateId: null,
    steps: '',
    trainingMinutes: '',
    intensity: 'low',
    notes: '',
  });
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [detailsTab, setDetailsTab] = useState<'28d' | '56d' | '90d' | 'quality' | 'templates'>('28d');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraftState | null>(null);
  const [isBodyCompositionModalOpen, setIsBodyCompositionModalOpen] = useState(false);
  const [bodyCompositionDraft, setBodyCompositionDraft] = useState<BodyCompositionDraftState | null>(null);
  const [isBowelLogModalOpen, setIsBowelLogModalOpen] = useState(false);
  const [bowelMovementDraft, setBowelMovementDraft] = useState<BowelMovementDraftState | null>(null);
  const [selectedWeightExportPeriod, setSelectedWeightExportPeriod] = useState<WeightExportPeriod>('30d');

  useEffect(() => {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  }, [profile]);

  const latestWeightEntry = useMemo(
    () => [...weightLogs].sort((a, b) => a.date.localeCompare(b.date)).filter((log) => Number.isFinite(log.weight ?? NaN)).at(-1) ?? null,
    [weightLogs]
  );

  const latestWeight = latestWeightEntry ? Number(latestWeightEntry.weightKg ?? latestWeightEntry.weight) : null;

  const latestBodyCompositionMeasurement = useMemo(
    () => bodyCompositionMeasurements[0] ?? null,
    [bodyCompositionMeasurements]
  );

  useEffect(() => {
    if (latestWeight !== null && Number.isFinite(latestWeight)) {
      setProfile((current) => (current.weightKg === latestWeight ? current : { ...current, weightKg: latestWeight }));
    }
  }, [latestWeight]);

  const defaultTemplates = useMemo(() => templates.filter((template) => template.isDefault), [templates]);
  const customTemplates = useMemo(() => templates.filter((template) => !template.isDefault), [templates]);
  const restTemplate = useMemo(() => templates.find((template) => template.templateKey === 'rest' || template.type === 'rest') ?? null, [templates]);
  const gymTemplate = useMemo(() => templates.find((template) => template.templateKey === 'gym' || template.type === 'gym') ?? null, [templates]);
  const matchTemplate = useMemo(() => templates.find((template) => template.templateKey === 'match' || template.type === 'match') ?? null, [templates]);
  const hikeTemplate = useMemo(() => templates.find((template) => template.templateKey === 'hike' || template.type === 'hike') ?? null, [templates]);

  useEffect(() => {
    setDraft((current) => {
      const activeTemplate =
        templates.find((template) => template.id === current.templateId) ??
        restTemplate ??
        defaultTemplates[0] ??
        null;

      if (!latestWeightEntry) {
        const defaults = getTemplateDefaults(activeTemplate ?? undefined);
        const nextDraft: WeightDraftState = {
          ...current,
          weight: latestWeight !== null ? latestWeight.toFixed(1) : '',
          templateMode: getTemplateMode(activeTemplate),
          templateId: activeTemplate?.id ?? null,
          steps: defaults.steps,
          trainingMinutes: defaults.trainingMinutes,
          intensity: defaults.intensity,
          notes: '',
        };

        return areTemplateDraftsEqual(current, nextDraft) ? current : nextDraft;
      }

      const latestTemplate =
        templates.find((template) => template.id === latestWeightEntry.activityTemplateId) ??
        restTemplate ??
        null;
      const defaults = getTemplateDefaults(latestTemplate ?? undefined);
      const nextDraft: WeightDraftState = {
        weight: Number.isFinite(latestWeight ?? NaN) ? (latestWeight as number).toFixed(1) : '',
        templateMode: getTemplateMode(latestTemplate),
        templateId: latestWeightEntry.activityTemplateId ?? restTemplate?.id ?? null,
        steps: latestWeightEntry.steps?.toString() ?? defaults.steps,
        trainingMinutes: latestWeightEntry.trainingMinutes?.toString() ?? defaults.trainingMinutes,
        intensity: latestWeightEntry.intensity ?? defaults.intensity,
        notes: latestWeightEntry.notes ?? '',
      };

      return areTemplateDraftsEqual(current, nextDraft) ? current : nextDraft;
    });
  }, [defaultTemplates, latestWeight, latestWeightEntry, restTemplate, templates]);

  const dailyIntake = useMemo(() => buildDailyIntakeFromMeals(meals, foods), [meals, foods]);

  const monthBaseSeries = useMemo(() => {
    return buildWeightHubSeries(
      weightLogs.map((log) => ({ ...log, weightKg: Number(log.weightKg ?? log.weight) || null })),
      dailyIntake,
      templates,
      monthStart,
      monthEnd
    );
  }, [dailyIntake, monthEnd, monthStart, templates, weightLogs]);

  const monthTrendSeries = useMemo(() => {
    const trendLogs = monthBaseSeries.map(toDailyLog);
    const moving = calculateMovingAverageTrend(trendLogs, 7);
    const validMoving = moving.filter((entry) => entry.trendWeightKg !== null);
    return validMoving.length >= 3 ? moving : calculateEWMATrend(trendLogs, 0.25);
  }, [monthBaseSeries]);

  const adaptiveBaseSeries = useMemo(() => {
    return buildWeightHubSeries(
      weightLogs.map((log) => ({ ...log, weightKg: Number(log.weightKg ?? log.weight) || null })),
      dailyIntake,
      templates,
      adaptiveStart,
      today
    );
  }, [adaptiveStart, dailyIntake, templates, today, weightLogs]);

  const adaptiveLogs = useMemo(() => adaptiveBaseSeries.map(toDailyLog), [adaptiveBaseSeries]);

  const estimate28 = useMemo(() => calculateAdaptiveTDEE(adaptiveLogs, 28, today), [adaptiveLogs, today]);
  const estimate56 = useMemo(() => calculateAdaptiveTDEE(adaptiveLogs, 56, today), [adaptiveLogs, today]);
  const estimate90 = useMemo(() => calculateAdaptiveTDEE(adaptiveLogs, 90, today), [adaptiveLogs, today]);
  const finalAdaptiveTDEE = useMemo(() => calculateFinalAdaptiveTDEE([estimate28, estimate56, estimate90]), [estimate28, estimate56, estimate90]);

  const templateEstimates = useMemo(
    () => calculateTemplateTDEEEstimates(templates, adaptiveLogs, finalAdaptiveTDEE, today),
    [adaptiveLogs, finalAdaptiveTDEE, templates, today]
  );

  const monthChartData = useMemo(
    () =>
      monthTrendSeries.map((point) => ({
        date: point.date,
        weight: point.weightKg,
        trendWeight: point.trendWeightKg,
        calories: point.calories,
        templateId: point.activityTemplateId,
        outlier: point.isWeightOutlier || point.isCalorieOutlier,
      })),
    [monthTrendSeries]
  );

  const weightExportRange = useMemo(
    () => getWeightExportRange(selectedWeightExportPeriod, today),
    [selectedWeightExportPeriod, today]
  );

  const weightExportSeries = useMemo(
    () =>
      buildWeightExportSeries(
        weightLogs.map((log) => ({ ...log, weightKg: Number(log.weightKg ?? log.weight) || null })),
        dailyIntake,
        templates,
        selectedWeightExportPeriod,
        today
      ),
    [dailyIntake, selectedWeightExportPeriod, templates, today, weightLogs]
  );

  const weightTableCsv = useMemo(() => buildWeightTableCsv(weightExportSeries), [weightExportSeries]);

  const weightTableFilename = useMemo(() => buildWeightTableFilename(weightExportRange), [weightExportRange]);

  const handleExportWeightTable = () => {
    downloadCsvFile(`\uFEFF${weightTableCsv}`, weightTableFilename);
    setMessage({ text: 'Weight table exported.', type: 'success' });
  };

  const latestTrendWeight = useMemo(() => {
    const lastTrendPoint = [...monthTrendSeries].reverse().find((point) => point.trendWeightKg !== null);
    return lastTrendPoint?.trendWeightKg ?? null;
  }, [monthTrendSeries]);

  const weight7DaysAgo = useMemo(() => getValueDaysAgo(monthBaseSeries, 7), [monthBaseSeries]);
  const weight28DaysAgo = useMemo(() => getValueDaysAgo(adaptiveBaseSeries, 28), [adaptiveBaseSeries]);
  const sevenDayChange = latestWeight !== null && weight7DaysAgo !== null ? latestWeight - weight7DaysAgo : null;
  const twentyEightDayChange = latestWeight !== null && weight28DaysAgo !== null ? latestWeight - weight28DaysAgo : null;
  const adaptiveRange = calculateTDEERange(finalAdaptiveTDEE, estimate28.confidence);

  const selectedTemplate = templates.find((template) => template.id === draft.templateId) ?? null;
  const selectedCustomTemplate =
    draft.templateMode === 'custom'
      ? customTemplates.find((template) => template.id === draft.templateId) ?? customTemplates[0] ?? null
      : null;

  const activeTemplateForDraft = selectedCustomTemplate ?? selectedTemplate ?? restTemplate ?? templates[0] ?? null;
  const dayTypeLabel = selectedTemplate?.isDefault
    ? selectedTemplate.name
    : draft.templateMode === 'custom'
      ? selectedCustomTemplate?.name ?? 'Custom template'
      : 'Rest day';

  const handleSaveDay = async () => {
    if (!draft.weight) {
      setMessage({ text: 'Add today\'s weight first.', type: 'error' });
      return;
    }

    const weight = Number(draft.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      setMessage({ text: 'Weight must be a valid number.', type: 'error' });
      return;
    }

    const steps = draft.steps.trim() === '' ? null : Number(draft.steps);
    const trainingMinutes = draft.trainingMinutes.trim() === '' ? null : Number(draft.trainingMinutes);

    try {
      await saveLogMutation.mutateAsync({
        userId,
        date: todayKey,
        entry: {
          weightKg: weight,
          activityTemplateId: selectedTemplate?.id ?? selectedCustomTemplate?.id ?? draft.templateId,
          steps: Number.isFinite(steps ?? NaN) ? steps : null,
          trainingMinutes: Number.isFinite(trainingMinutes ?? NaN) ? trainingMinutes : null,
          intensity: draft.intensity,
          notes: draft.notes.trim() ? draft.notes.trim() : null,
        },
      });
      setMessage({ text: 'Daily log saved.', type: 'success' });
      setProfile((current) => ({ ...current, weightKg: weight }));
    } catch (error) {
      console.error('Failed to save weight log:', error);
      setMessage({ text: 'Failed to save the daily log.', type: 'error' });
    }
  };

  const openBodyCompositionEditor = (measurement?: BodyCompositionMeasurement) => {
    setBodyCompositionDraft(createBodyCompositionDraft(measurement ?? latestBodyCompositionMeasurement));
    setIsBodyCompositionModalOpen(true);
  };

  const openBowelLogEditor = (entry?: BowelMovement) => {
    setBowelMovementDraft(createBowelMovementDraft(entry ?? null));
    setIsBowelLogModalOpen(true);
  };

  const handleSaveBodyCompositionMeasurement = async () => {
    if (!bodyCompositionDraft) return;

    const payload = {
      id: bodyCompositionDraft.id,
      measuredAt: bodyCompositionDraft.measuredAt,
      source: bodyCompositionDraft.source.trim() || BODY_COMPOSITION_MEASUREMENT_SOURCE_DEFAULT,
      weightKg: toNullableNumber(bodyCompositionDraft.weightKg),
      bodyFatPercent: toNullableNumber(bodyCompositionDraft.bodyFatPercent),
      bodyFatMassKg: toNullableNumber(bodyCompositionDraft.bodyFatMassKg),
      skeletalMuscleMassKg: toNullableNumber(bodyCompositionDraft.skeletalMuscleMassKg),
      basalMetabolicRateKcal: toNullableNumber(bodyCompositionDraft.basalMetabolicRateKcal),
      visceralFatLevel: toNullableNumber(bodyCompositionDraft.visceralFatLevel),
      ecwRatio: toNullableNumber(bodyCompositionDraft.ecwRatio),
      bodyCellMassKg: toNullableNumber(bodyCompositionDraft.bodyCellMassKg),
      notes: bodyCompositionDraft.notes.trim() ? bodyCompositionDraft.notes.trim() : null,
    };

    if (!payload.measuredAt) {
      setMessage({ text: 'Measurement date is required.', type: 'error' });
      return;
    }

    try {
      await saveBodyCompositionMutation.mutateAsync({
        userId,
        measurement: payload,
      });
      setMessage({ text: payload.id ? 'Body composition measurement updated.' : 'Body composition measurement added.', type: 'success' });
      setIsBodyCompositionModalOpen(false);
      setBodyCompositionDraft(null);
    } catch (error) {
      console.error('Failed to save body composition measurement:', error);
      setMessage({ text: 'Failed to save the body composition measurement.', type: 'error' });
    }
  };

  const handleSaveBowelMovement = async () => {
    if (!bowelMovementDraft) return;

    const occurredAt = new Date(`${bowelMovementDraft.date}T${bowelMovementDraft.time}`);
    if (Number.isNaN(occurredAt.getTime())) {
      setMessage({ text: 'Enter a valid bowel movement date and time.', type: 'error' });
      return;
    }

    try {
      await saveBowelMovementMutation.mutateAsync({
        userId,
        occurredAt: occurredAt.toISOString(),
        notes: bowelMovementDraft.notes.trim() ? bowelMovementDraft.notes.trim() : null,
        id: bowelMovementDraft.id,
      });
      setMessage({ text: 'Bowel movement saved.', type: 'success' });
      setIsBowelLogModalOpen(false);
      setBowelMovementDraft(null);
    } catch (error) {
      console.error('Failed to save bowel movement:', error);
      setMessage({ text: 'Failed to save the bowel movement entry.', type: 'error' });
    }
  };

  const handleDeleteBowelMovement = async (entry: BowelMovement) => {
    try {
      await deleteBowelMovementMutation.mutateAsync({ userId, id: entry.id });
      setMessage({ text: 'Bowel movement deleted.', type: 'success' });
    } catch (error) {
      console.error('Failed to delete bowel movement:', error);
      setMessage({ text: 'Failed to delete the bowel movement entry.', type: 'error' });
    }
  };

  const handleDeleteBodyCompositionMeasurement = async (measurement: BodyCompositionMeasurement) => {
    if (!window.confirm(`Delete the ${formatDateLabel(measurement.measuredAt)} measurement?`)) return;

    try {
      await deleteBodyCompositionMutation.mutateAsync({
        userId,
        measurementId: measurement.id,
      });
      setMessage({ text: 'Body composition measurement deleted.', type: 'success' });
    } catch (error) {
      console.error('Failed to delete body composition measurement:', error);
      setMessage({ text: 'Failed to delete the body composition measurement.', type: 'error' });
    }
  };

  const openTemplateEditor = (template?: ActivityDayTemplate) => {
    setTemplateDraft(
      template
        ? buildTemplateDraft(template)
        : {
            templateKey: null,
            name: '',
            type: 'custom',
            defaultSteps: '',
            defaultTrainingMinutes: '',
            defaultIntensity: 'low',
            estimatedActivityKcal: '0',
            includeInAdaptiveModel: true,
            isDefault: false,
          }
    );
    setIsTemplateModalOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateDraft) return;
    if (!templateDraft.name.trim()) {
      setMessage({ text: 'Template name is required.', type: 'error' });
      return;
    }

    try {
      await saveTemplateMutation.mutateAsync({
        userId,
        id: templateDraft.id,
        templateKey: templateDraft.templateKey,
        name: templateDraft.name.trim(),
        type: templateDraft.type,
        defaultSteps: templateDraft.defaultSteps.trim() ? Number(templateDraft.defaultSteps) : null,
        defaultTrainingMinutes: templateDraft.defaultTrainingMinutes.trim() ? Number(templateDraft.defaultTrainingMinutes) : null,
        defaultIntensity: templateDraft.defaultIntensity,
        estimatedActivityKcal: templateDraft.estimatedActivityKcal.trim() ? Number(templateDraft.estimatedActivityKcal) : 0,
        includeInAdaptiveModel: templateDraft.includeInAdaptiveModel,
        isDefault: templateDraft.isDefault,
      });
      setMessage({ text: 'Template saved.', type: 'success' });
      setIsTemplateModalOpen(false);
      setTemplateDraft(null);
    } catch (error) {
      console.error('Failed to save template:', error);
      setMessage({ text: 'Failed to save the template.', type: 'error' });
    }
  };

  const handleResetDefaults = async () => {
    try {
      const defaults = getDefaultActivityDayTemplates(userId);
      await Promise.all(
        defaults.map((template) =>
          saveTemplateMutation.mutateAsync({
            userId,
            templateKey: template.templateKey,
            name: template.name,
            type: template.type,
            defaultSteps: template.defaultSteps ?? null,
            defaultTrainingMinutes: template.defaultTrainingMinutes ?? null,
            defaultIntensity: template.defaultIntensity ?? 'low',
            estimatedActivityKcal: template.estimatedActivityKcal ?? 0,
            includeInAdaptiveModel: true,
            isDefault: true,
          })
        )
      );
      setMessage({ text: 'Default templates restored.', type: 'success' });
    } catch (error) {
      console.error('Failed to reset templates:', error);
      setMessage({ text: 'Failed to reset templates.', type: 'error' });
    }
  };

  const handleDeleteTemplate = async (template: ActivityDayTemplate) => {
    if (template.isDefault) return;
    try {
      await deleteTemplateMutation.mutateAsync(template.id);
      setMessage({ text: 'Template deleted.', type: 'success' });
    } catch (error) {
      console.error('Failed to delete template:', error);
      setMessage({ text: 'Failed to delete template.', type: 'error' });
    }
  };

  const adaptiveInterpretation = useMemo(() => {
    const averageIntake = estimate28.avgCalories;
    const intakeLabel = formatKcalPerDay(averageIntake);
    const trendChange = estimate28.weeklyWeightChangeKg;
    const stableThreshold = 0.1;

    if (averageIntake === null || !Number.isFinite(trendChange)) {
      return 'Not enough data yet to interpret this estimate.';
    }

    if (trendChange > stableThreshold) {
      return `Your average intake was ${intakeLabel} and your trend weight increased slightly, so estimated maintenance is below your average intake.`;
    }

    if (trendChange < -stableThreshold) {
      return `Your average intake was ${intakeLabel} and your trend weight decreased, so estimated maintenance is above your average intake.`;
    }

    return 'Your trend weight was mostly stable, so estimated maintenance is close to your average intake.';
  }, [estimate28.avgCalories, estimate28.weeklyWeightChangeKg]);

  const adaptiveRangeLabel = formatKcalRangePerDay(adaptiveRange.lowerBound, adaptiveRange.upperBound);
  const adaptiveMainValue = formatKcalPerDay(finalAdaptiveTDEE);

  const { bodyFatPercent: formulaBodyFatPercent, source: formulaBodyFatSource } = resolveFormulaBodyFatPercent(
    latestBodyCompositionMeasurement?.bodyFatPercent,
    profile.bodyFatPercent
  );
  const formulaBodyFatSourceLabel =
    formulaBodyFatSource === 'latest body composition measurement'
      ? 'From latest body composition measurement'
      : formulaBodyFatSource === 'manual fallback'
        ? 'Manual fallback'
        : 'Unavailable';
  const formulaWeight = latestBodyCompositionMeasurement?.weightKg ?? profile.weightKg ?? latestWeight ?? null;
  const formulaProfile = toProfilePayload({ ...profile, bodyFatPercent: formulaBodyFatPercent }, formulaWeight);
  const formulaBMR = formulaWeight !== null ? calculateFormulaBMR(formulaProfile) : null;
  const formulaTDEE = formulaWeight !== null ? calculateFormulaTDEE(formulaProfile) : null;
  const measuredBMR = latestBodyCompositionMeasurement?.basalMetabolicRateKcal ?? null;
  const formulaMethod = Number.isFinite(formulaBodyFatPercent ?? NaN) ? 'Katch-McArdle' : 'Mifflin-St Jeor';

  const [monthChartRef, monthChartSize] = useElementSize<HTMLDivElement>();
  const hasMonthChartData = monthChartData.some((point) => point.weight !== null);
  const canRenderMonthChart = hasMonthChartData && monthChartSize.width > 0 && monthChartSize.height > 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pb-24 space-y-6">
      <div className="rounded-[2.25rem] border border-border bg-white p-5 sm:p-7 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-accent">Weight hub</div>
            <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-ink">Adaptive TDEE / energy balance</h1>
            <p className="mt-2 max-w-3xl text-sm text-subtle">
              Quick weight logging, clean formula-based TDEE, adaptive maintenance estimates, and day-type maintenance bands.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MiniBadge label={`Latest weight: ${formatKg(latestWeight)}`} tone="bg-slate-50 text-slate-700 border-slate-100" />
            <MiniBadge label={`Adaptive confidence: ${confidenceLabel(estimate28.confidence)}`} tone={confidenceTone(estimate28.confidence)} />
          </div>
        </div>
        {message ? (
          <div className={cn('mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold', message.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700')}>
            {message.text}
          </div>
        ) : null}
      </div>

      <Card
        title="Today's log"
        subtitle="Quick body weight logging with optional activity data."
        action={
          <button onClick={handleSaveDay} className="inline-flex items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-sm font-black text-white shadow-sm hover:opacity-95 transition-all">
            <span>Save</span>
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-[1.75rem] border border-border bg-gray-50/70 p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Today&apos;s weight</label>
                <div className="mt-2 flex items-end gap-3 rounded-[1.5rem] border border-border bg-white px-4 py-4">
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={draft.weight}
                    onChange={(e) => setDraft((current) => ({ ...current, weight: e.target.value }))}
                    className="w-full border-none bg-transparent p-0 text-5xl font-black tracking-tight text-ink outline-none focus:ring-0"
                    placeholder="0.0"
                  />
                  <span className="pb-2 text-sm font-black uppercase tracking-widest text-subtle">kg</span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { key: 'rest', label: 'Rest day', template: restTemplate },
                { key: 'gym', label: 'Gym day', template: gymTemplate },
                { key: 'match', label: 'Match day', template: matchTemplate },
                { key: 'hike', label: 'Hiking day', template: hikeTemplate },
                { key: 'custom', label: 'Custom template', template: null },
              ].map((option) => {
                const active =
                  option.key === 'custom'
                    ? draft.templateMode === 'custom'
                    : draft.templateMode === option.key;

                return (
                  <button
                    key={option.key}
                    onClick={() => {
                      if (option.key === 'custom') {
                        setDraft((current) => ({
                          ...current,
                          templateMode: 'custom',
                          templateId: customTemplates[0]?.id ?? null,
                        }));
                        return;
                      }

                      const template = option.template;
                      setDraft((current) => ({
                        ...current,
                        templateMode: option.key as TemplateMode,
                        templateId: template?.id ?? null,
                        steps: template?.defaultSteps?.toString() ?? current.steps,
                        trainingMinutes: template?.defaultTrainingMinutes?.toString() ?? current.trainingMinutes,
                        intensity: template?.defaultIntensity ?? current.intensity,
                      }));
                    }}
                    className={cn(
                      'rounded-2xl border px-3 py-3 text-left text-sm font-black transition-all',
                      active ? 'border-accent bg-accent text-white shadow-sm' : 'border-border bg-white text-ink hover:bg-gray-50'
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {draft.templateMode === 'custom' ? (
              <div className="mt-3 rounded-2xl border border-border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Custom template</label>
                  <button onClick={() => openTemplateEditor()} className="text-xs font-black uppercase tracking-widest text-accent">
                    Create template
                  </button>
                </div>
                <select
                  value={draft.templateId ?? ''}
                  onChange={(e) => {
                    const template = customTemplates.find((item) => item.id === e.target.value) ?? null;
                    setDraft((current) => ({
                      ...current,
                      templateId: template?.id ?? null,
                      steps: template?.defaultSteps?.toString() ?? current.steps,
                      trainingMinutes: template?.defaultTrainingMinutes?.toString() ?? current.trainingMinutes,
                      intensity: template?.defaultIntensity ?? current.intensity,
                    }));
                  }}
                  className="mt-2 w-full rounded-2xl border border-border bg-gray-50 px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Select a custom template</option>
                  {customTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                {customTemplates.length === 0 ? <p className="mt-2 text-xs text-subtle">No custom templates yet.</p> : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Steps</label>
                <input
                  type="number"
                  min={0}
                  value={draft.steps}
                  onChange={(e) => setDraft((current) => ({ ...current, steps: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Training time</label>
                <input
                  type="number"
                  min={0}
                  value={draft.trainingMinutes}
                  onChange={(e) => setDraft((current) => ({ ...current, trainingMinutes: e.target.value }))}
                  className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Intensity</label>
                <select
                  value={draft.intensity}
                  onChange={(e) => setDraft((current) => ({ ...current, intensity: e.target.value as ActivityIntensity }))}
                  className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="low">Low</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                  <option value="very_high">Very high</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Day type</label>
                <div className="mt-2 rounded-2xl border border-border bg-gray-50 px-4 py-3 text-sm font-black text-ink">
                  {dayTypeLabel}
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Notes</label>
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
                rows={4}
                className="mt-2 w-full rounded-[1.5rem] border border-border bg-white px-4 py-3 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="Optional notes"
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Current weight and trend" subtitle="Latest measurement, short-term change, and trend weight.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Latest weight" value={formatKg(latestWeight)} />
            <Metric label="Trend weight" value={formatKg(latestTrendWeight)} />
            <Metric label="7-day change" value={formatKg(sevenDayChange)} />
            <Metric label="28-day change" value={formatKg(twentyEightDayChange)} />
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-gray-50/70 px-4 py-3 text-sm font-semibold text-subtle">
            Estimated weekly change: {formatKg(estimate28.weeklyWeightChangeKg).replace('kg', 'kg / week')}
          </div>
        </Card>

        <Card title="Formula-based estimate" subtitle="Classic BMR/TDEE based on profile inputs and the latest body composition data when available.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Formula BMR" value={formatKcal(formulaBMR)} />
            <Metric label="Formula TDEE" value={formatKcal(formulaTDEE)} />
            <Metric label="Measured BMR" value={formatKcal(measuredBMR)} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Age</label>
              <input
                type="number"
                value={profile.age}
                onChange={(e) => setProfile((current) => ({ ...current, age: Number(e.target.value) || 0 }))}
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Height</label>
              <input
                type="number"
                value={profile.heightCm}
                onChange={(e) => setProfile((current) => ({ ...current, heightCm: Number(e.target.value) || 0 }))}
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Sex</label>
              <select
                value={profile.sex}
                onChange={(e) => setProfile((current) => ({ ...current, sex: e.target.value as Sex }))}
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Activity</label>
              <select
                value={profile.activityLevel}
                onChange={(e) => setProfile((current) => ({ ...current, activityLevel: e.target.value as ActivityLevel }))}
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="sedentary">Sedentary</option>
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="active">Active</option>
                <option value="very_active">Very active</option>
              </select>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-gray-50 px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Formula used</div>
              <div className="mt-1 text-sm font-black text-ink">{formulaMethod}</div>
            </div>
            <div className="rounded-2xl border border-border bg-gray-50 px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Body fat source</div>
              <div className="mt-1 text-sm font-black text-ink">{formulaBodyFatSourceLabel}</div>
            </div>
            <div className="rounded-2xl border border-border bg-gray-50 px-4 py-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">
                    {formulaBodyFatSource === 'latest body composition measurement' ? 'Body fat %' : 'Manual fallback body fat %'}
                  </div>
                  <div className="mt-1 text-sm font-black text-ink">
                    {formulaBodyFatSource === 'latest body composition measurement' ? (
                      <span>{formatPercentValue(formulaBodyFatPercent)}</span>
                    ) : (
                      <input
                        type="number"
                        value={profile.bodyFatPercent ?? ''}
                        onChange={(e) =>
                          setProfile((current) => ({
                            ...current,
                            bodyFatPercent: e.target.value === '' ? null : Number(e.target.value) || null,
                          }))
                        }
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                        placeholder="Optional"
                      />
                    )}
                  </div>
                </div>
                <div className="max-w-[15rem] text-right text-xs font-semibold leading-5 text-subtle">
                  {formulaBodyFatSource === 'latest body composition measurement'
                    ? 'Read-only value from the latest body composition measurement.'
                    : formulaBodyFatSource === 'manual fallback'
                      ? 'Used only when no body composition body fat value is available.'
                      : 'No body fat value is available. Formula falls back to Mifflin-St Jeor until a manual value is entered.'}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-3 rounded-2xl border border-border bg-gray-50 px-4 py-3 text-sm text-subtle">
            <div>
              Formula used: <span className="font-black text-ink">{formulaMethod}</span>
            </div>
            <div>
              Body fat source: <span className="font-black text-ink">{formulaBodyFatSourceLabel}</span>
            </div>
            <div>Measured BMR is from body composition measurement. Adaptive TDEE is based on logged intake and weight trend.</div>
          </div>
        </Card>
      </div>

      <Card
        title="Body Composition"
        subtitle="Latest InBody summary, measured BMR, and compact measurement history."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => openBowelLogEditor()}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-subtle hover:text-ink hover:bg-gray-50 transition-all"
            >
              <span>Bowel log</span>
            </button>
            <button
              onClick={() => openBodyCompositionEditor()}
              className="inline-flex items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-sm font-black text-white shadow-sm hover:opacity-95 transition-all"
            >
              <span>Add measurement</span>
            </button>
          </div>
        }
      >
        {latestBodyCompositionMeasurement ? (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <MiniBadge label={formatDateLabel(latestBodyCompositionMeasurement.measuredAt)} tone="bg-slate-50 text-slate-700 border-slate-100" />
                <MiniBadge label={latestBodyCompositionMeasurement.source} tone="bg-violet-50 text-violet-700 border-violet-100" />
                <MiniBadge label={`Measured BMR: ${formatKcal(measuredBMR)}`} tone="bg-emerald-50 text-emerald-700 border-emerald-100" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Metric label="Weight" value={formatKg(latestBodyCompositionMeasurement.weightKg)} />
                <Metric label="Body fat %" value={formatPercentValue(latestBodyCompositionMeasurement.bodyFatPercent)} />
                <Metric label="Body fat mass" value={formatKg(latestBodyCompositionMeasurement.bodyFatMassKg)} />
                <Metric label="Skeletal muscle" value={formatKg(latestBodyCompositionMeasurement.skeletalMuscleMassKg)} />
                <Metric label="Visceral fat" value={formatFloat(latestBodyCompositionMeasurement.visceralFatLevel, 0)} />
                <Metric label="ECW ratio" value={formatFloat(latestBodyCompositionMeasurement.ecwRatio, 3)} />
                <Metric label="Body cell mass" value={formatKg(latestBodyCompositionMeasurement.bodyCellMassKg)} />
                <Metric label="BMR" value={formatKcal(latestBodyCompositionMeasurement.basalMetabolicRateKcal)} />
              </div>
            </div>
            <div className="rounded-[1.75rem] border border-border bg-gray-50/80 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Notes</div>
              <p className="mt-2 text-sm font-medium leading-6 text-ink">
                {latestBodyCompositionMeasurement.notes?.trim() ? latestBodyCompositionMeasurement.notes : 'No notes recorded.'}
              </p>
              <div className="mt-4 rounded-2xl border border-border bg-white px-4 py-3 text-sm text-subtle">
                Latest body fat % takes priority for Katch-McArdle when available. Measured BMR remains separate from adaptive TDEE.
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-border bg-gray-50 px-5 py-5 text-sm text-subtle">
            No body composition measurements yet. Add the first InBody entry to unlock measured BMR and compact history.
          </div>
        )}

        <div className="mt-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-sm font-black text-ink">History</div>
              <p className="text-xs text-subtle">Most recent first. Compact rows keep the section scannable.</p>
            </div>
            <div className="text-xs font-semibold text-subtle">{bodyCompositionMeasurements.length} measurements</div>
          </div>

          <div className="mt-3 max-h-[360px] space-y-2 overflow-auto pr-1">
            {bodyCompositionMeasurements.length > 0 ? (
              bodyCompositionMeasurements.map((measurement) => (
                <div
                  key={measurement.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate font-black text-ink">{formatDateLabel(measurement.measuredAt)}</div>
                      <MiniBadge label={measurement.source} tone="bg-slate-50 text-slate-600 border-slate-100" />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-subtle">
                      <span>{formatKg(measurement.weightKg)}</span>
                      <span>BF {formatPercentValue(measurement.bodyFatPercent)}</span>
                      <span>BMR {formatKcal(measurement.basalMetabolicRateKcal)}</span>
                      <span>SMM {formatKg(measurement.skeletalMuscleMassKg)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => openBodyCompositionEditor(measurement)}
                      className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-ink hover:bg-gray-50 transition-all"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDeleteBodyCompositionMeasurement(measurement)}
                      className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-8 text-center text-sm text-subtle">
                Measurement history will appear here after you add an entry.
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Monthly weight chart"
        subtitle="Daily body weight points for the current month with a simple trend line."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-gray-50 p-1">
              {WEIGHT_EXPORT_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSelectedWeightExportPeriod(option.id)}
                  className={cn(
                    'rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest transition-all',
                    selectedWeightExportPeriod === option.id ? 'bg-ink text-white shadow-sm' : 'text-subtle hover:text-ink'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleExportWeightTable}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-white px-4 py-2 text-sm font-black text-ink hover:bg-gray-50 transition-all"
              title="Export the selected weight period as CSV"
            >
              <Download size={16} />
              <span>Export weight table</span>
            </button>
          </div>
        }
      >
        <div className="mb-4 rounded-2xl border border-border bg-gray-50/80 px-4 py-3 text-xs font-semibold text-subtle">
          Export range: {normalizeDateToLocal(weightExportRange.start)} to {normalizeDateToLocal(weightExportRange.end)}
        </div>
        <div ref={monthChartRef} className="h-[340px] w-full">
          {canRenderMonthChart ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthChartData} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => format(new Date(`${value}T00:00:00`), 'd')}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  domain={['dataMin - 1', 'dataMax + 1']}
                  tickFormatter={(value) => Number(value).toFixed(1)}
                />
                <Tooltip
                  labelFormatter={(value) => format(new Date(`${value}T00:00:00`), 'MMMM d')}
                  formatter={(value: number | string, name) => {
                    if (name === 'weight') return [formatKg(Number(value)).replace('kg', ''), 'Weight'];
                    if (name === 'trend') return [formatKg(Number(value)).replace('kg', ''), 'Trend'];
                    if (name === 'calories') return [formatKcal(Number(value)).replace('kcal', ''), 'Calories'];
                    return [value, name];
                  }}
                  contentStyle={{ borderRadius: '18px', border: 'none', boxShadow: '0 16px 32px rgba(15, 23, 42, 0.12)' }}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#111827"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#111827', stroke: '#fff', strokeWidth: 1 }}
                  connectNulls={false}
                  name="weight"
                />
                <Line
                  type="monotone"
                  dataKey="trendWeight"
                  stroke="#8b5cf6"
                  strokeWidth={3}
                  dot={false}
                  connectNulls
                  name="trend"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-8 text-center text-sm text-subtle">
              {hasMonthChartData ? 'Chart is preparing its layout.' : 'No weight logs yet for this month.'}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Estimated maintenance" subtitle="Based on recent intake and weight trend.">
          <div className="space-y-5">
            <div className="rounded-[1.75rem] border border-border bg-gray-50/70 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <MiniBadge label="Estimated maintenance" tone="bg-ink text-white border-ink" />
                    <MiniBadge label={`Confidence: ${confidenceLabel(estimate28.confidence)}`} tone={confidenceTone(estimate28.confidence)} />
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-subtle">Estimated maintenance</div>
                    <div className="mt-1 text-4xl font-black tracking-tight text-ink sm:text-5xl">{adaptiveMainValue}</div>
                    <div className="mt-2 text-sm font-semibold text-subtle">Likely range: {adaptiveRangeLabel}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[26rem]">
                  <Metric label="Current trend" value={formatKgPerWeek(estimate28.weeklyWeightChangeKg)} />
                  <Metric label="Average intake" value={formatKcalPerDay(estimate28.avgCalories)} />
                  <div className="rounded-2xl border border-border bg-white px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-subtle">Based on</div>
                    <div className="mt-1 text-sm font-black text-ink">
                      {estimate28.calorieDaysCount} calorie days · {estimate28.weightEntriesCount} weight entries
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium leading-6 text-ink">
                {adaptiveInterpretation}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-border bg-gray-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-subtle">Model details</div>
                  <div className="mt-1 text-sm font-semibold text-subtle">Technical fields kept compact for reference.</div>
                </div>
                {estimate28.confidence === 'insufficient_data' || finalAdaptiveTDEE === null ? (
                  <div className="text-xs font-semibold text-subtle">
                    Need {estimate28.missingCalorieDaysNeeded} more calorie days and {estimate28.missingWeightEntriesNeeded} more weight entries.
                  </div>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
                <Metric label="Weight slope" value={formatFloat(estimate28.weightSlopeKgPerDay, 4)} suffix="kg/day" />
                <Metric label="Estimated daily energy balance" value={formatKcal(estimate28.estimatedDailyEnergyBalance)} />
                <Metric label="Calorie coverage" value={formatPercent(estimate28.calorieCoverage)} />
                <Metric label="Activity coverage" value={formatPercent(estimate28.activityCoverage)} />
                <Metric label="Calorie days" value={estimate28.calorieDaysCount.toString()} />
                <Metric label="Weight entries" value={estimate28.weightEntriesCount.toString()} />
              </div>
            </div>
          </div>
        </Card>

        <Card title="Maintenance by day type" subtitle="Estimated maintenance for each template relative to the 28-day adaptive base.">
          <div className="space-y-3">
            {[restTemplate, gymTemplate, matchTemplate, hikeTemplate, ...customTemplates].filter(Boolean).map((template) => {
              const estimate = templateEstimates.find((item) => item.templateId === (template as ActivityDayTemplate).id);
              return (
                <div key={(template as ActivityDayTemplate).id}>
                  <TemplateRow
                    template={template as ActivityDayTemplate}
                    estimate={estimate}
                    onEdit={() => openTemplateEditor(template as ActivityDayTemplate)}
                    onDelete={template && !(template as ActivityDayTemplate).isDefault ? () => void handleDeleteTemplate(template as ActivityDayTemplate) : undefined}
                  />
                </div>
              );
            })}
            <div className="pt-2 text-xs font-semibold text-subtle">
              Template sample days: custom templates start low confidence until usage builds up.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Adaptive details" subtitle="28, 56, 90-day estimates and data-quality diagnostics.">
        <div className="flex flex-wrap gap-2 border-b border-border pb-4">
          {[
            { id: '28d', label: '28 days' },
            { id: '56d', label: '56 days' },
            { id: '90d', label: '90 days' },
            { id: 'quality', label: 'Data quality' },
            { id: 'templates', label: 'Templates' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDetailsTab(tab.id as typeof detailsTab)}
              className={cn(
                'rounded-2xl px-4 py-2 text-sm font-black transition-all',
                detailsTab === tab.id ? 'bg-ink text-white' : 'bg-gray-50 text-subtle hover:text-ink'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pt-5">
          {detailsTab === '28d' ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="TDEE" value={formatKcal(estimate28.finalTDEE)} />
              <Metric label="Score" value={estimate28.score.toString()} />
              <Metric label="Lower bound" value={formatKcal(estimate28.lowerBound)} />
              <Metric label="Upper bound" value={formatKcal(estimate28.upperBound)} />
              <Metric label="Calorie days" value={estimate28.calorieDaysCount.toString()} />
              <Metric label="Weight entries" value={estimate28.weightEntriesCount.toString()} />
              <Metric label="Outlier days" value={estimate28.outlierDaysCount.toString()} />
              <Metric label="Data span" value={`${estimate28.dataSpanDays} days`} />
            </div>
          ) : null}

          {detailsTab === '56d' ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="TDEE" value={formatKcal(estimate56.finalTDEE)} />
              <Metric label="Score" value={estimate56.score.toString()} />
              <Metric label="Lower bound" value={formatKcal(estimate56.lowerBound)} />
              <Metric label="Upper bound" value={formatKcal(estimate56.upperBound)} />
              <Metric label="Calorie days" value={estimate56.calorieDaysCount.toString()} />
              <Metric label="Weight entries" value={estimate56.weightEntriesCount.toString()} />
              <Metric label="Outlier days" value={estimate56.outlierDaysCount.toString()} />
              <Metric label="Data span" value={`${estimate56.dataSpanDays} days`} />
            </div>
          ) : null}

          {detailsTab === '90d' ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="TDEE" value={formatKcal(estimate90.finalTDEE)} />
              <Metric label="Score" value={estimate90.score.toString()} />
              <Metric label="Lower bound" value={formatKcal(estimate90.lowerBound)} />
              <Metric label="Upper bound" value={formatKcal(estimate90.upperBound)} />
              <Metric label="Calorie days" value={estimate90.calorieDaysCount.toString()} />
              <Metric label="Weight entries" value={estimate90.weightEntriesCount.toString()} />
              <Metric label="Outlier days" value={estimate90.outlierDaysCount.toString()} />
              <Metric label="Data span" value={`${estimate90.dataSpanDays} days`} />
            </div>
          ) : null}

          {detailsTab === 'quality' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Calorie coverage" value={formatPercent(estimate28.calorieCoverage)} />
              <Metric label="Weight coverage" value={formatPercent(estimate28.weightCoverage)} />
              <Metric label="Activity coverage" value={formatPercent(estimate28.activityCoverage)} />
              <Metric label="Suspicious days" value={estimate28.outlierDaysCount.toString()} />
              <Metric label="Missing calorie days" value={estimate28.missingCalorieDaysNeeded.toString()} />
              <Metric label="Missing weight entries" value={estimate28.missingWeightEntriesNeeded.toString()} />
              <Metric label="Confidence" value={confidenceLabel(estimate28.confidence)} />
              <Metric label="Final adaptive TDEE" value={formatKcal(finalAdaptiveTDEE)} />
            </div>
          ) : null}

          {detailsTab === 'templates' ? (
            <div className="grid grid-cols-1 gap-3">
              {templates.map((template) => {
                const estimate = templateEstimates.find((item) => item.templateId === template.id);
                return (
                  <div key={template.id} className="rounded-2xl border border-border bg-gray-50/60 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-black text-ink">{template.name}</div>
                        <div className="text-xs font-semibold text-subtle">
                          {template.defaultSteps ?? 0} steps · {template.defaultTrainingMinutes ?? 0} min · {template.defaultIntensity ?? 'low'}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <MiniBadge label={`Samples: ${estimate?.sampleDays ?? 0}`} tone="bg-slate-50 text-slate-600 border-slate-100" />
                        <MiniBadge label={confidenceLabel(estimate?.confidence ?? 'low')} tone={confidenceTone(estimate?.confidence ?? 'low')} />
                        <MiniBadge label={formatKcal(estimate?.estimatedTemplateTDEE)} tone="bg-white text-ink border-border" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Card>

      <Card
        title="Template manager"
        subtitle="Create custom templates, edit defaults, or reset the default four templates."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => openTemplateEditor()} className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-black text-white transition-all hover:opacity-95">
              New template
            </button>
            <button onClick={handleResetDefaults} className="rounded-2xl border border-border bg-white px-4 py-2.5 text-sm font-black text-ink transition-all hover:bg-gray-50">
              Reset defaults
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {templates.length > 0 ? (
            templates.map((template) => (
              <div key={template.id} className="rounded-2xl border border-border bg-gray-50/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate font-black text-ink">{template.name}</div>
                      <MiniBadge label={template.isDefault ? 'Default' : 'Custom'} tone={template.isDefault ? 'bg-slate-50 text-slate-600 border-slate-100' : 'bg-violet-50 text-violet-700 border-violet-100'} />
                    </div>
                    <div className="mt-1 text-xs font-semibold text-subtle">
                      Activity kcal: {Math.round(Number(template.estimatedActivityKcal ?? 0))} · Samples: {templateEstimates.find((item) => item.templateId === template.id)?.sampleDays ?? 0}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openTemplateEditor(template)} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-ink transition-all hover:bg-gray-50">
                      Edit
                    </button>
                    {!template.isDefault ? (
                      <button onClick={() => void handleDeleteTemplate(template)} className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 transition-all hover:bg-red-100">
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-8 text-center text-sm text-subtle">
              Loading activity templates...
            </div>
          )}
        </div>
      </Card>

      <AnimatePresence>
        {isTemplateModalOpen && templateDraft ? (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-ink/60 backdrop-blur-md" onClick={() => setIsTemplateModalOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 28, scale: 0.98 }}
              className="relative w-full sm:max-w-2xl max-h-[90vh] overflow-auto rounded-t-[2rem] bg-white p-5 sm:rounded-[2rem] sm:p-6 shadow-2xl border border-border"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-black text-ink">{templateDraft.id ? 'Edit template' : 'New template'}</h3>
                  <p className="text-sm text-subtle">Keep default templates separate from custom ones.</p>
                </div>
                <button onClick={() => setIsTemplateModalOpen(false)} className="rounded-xl border border-border px-3 py-2 text-sm font-bold text-subtle hover:text-ink hover:bg-gray-50">
                  Close
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Name</label>
                  <input
                    value={templateDraft.name}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, name: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Type</label>
                  <select
                    value={templateDraft.type}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, type: e.target.value as ActivityDayTemplate['type'] } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="rest">Rest</option>
                    <option value="gym">Gym</option>
                    <option value="match">Match</option>
                    <option value="hike">Hike</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Estimated activity kcal</label>
                  <input
                    type="number"
                    value={templateDraft.estimatedActivityKcal}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, estimatedActivityKcal: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Default steps</label>
                  <input
                    type="number"
                    value={templateDraft.defaultSteps}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, defaultSteps: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Training minutes</label>
                  <input
                    type="number"
                    value={templateDraft.defaultTrainingMinutes}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, defaultTrainingMinutes: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Intensity</label>
                  <select
                    value={templateDraft.defaultIntensity}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, defaultIntensity: e.target.value as ActivityIntensity } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="low">Low</option>
                    <option value="moderate">Moderate</option>
                    <option value="high">High</option>
                    <option value="very_high">Very high</option>
                  </select>
                </div>
                <div className="sm:col-span-2 flex items-center gap-2">
                  <input
                    id="include-in-model"
                    type="checkbox"
                    checked={templateDraft.includeInAdaptiveModel}
                    onChange={(e) => setTemplateDraft((current) => (current ? { ...current, includeInAdaptiveModel: e.target.checked } : current))}
                    className="h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
                  />
                  <label htmlFor="include-in-model" className="text-sm font-semibold text-ink">
                    Include in adaptive model
                  </label>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                {templateDraft.isDefault ? (
                  <button onClick={handleResetDefaults} className="rounded-2xl border border-border bg-white px-4 py-2.5 text-sm font-black text-ink hover:bg-gray-50">
                    Reset defaults
                  </button>
                ) : null}
                <button onClick={handleSaveTemplate} className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:opacity-95">
                  Save template
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isBodyCompositionModalOpen && bodyCompositionDraft ? (
          <div className="fixed inset-0 z-[210] flex items-end justify-center p-0 sm:items-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/60 backdrop-blur-md"
              onClick={() => setIsBodyCompositionModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 28, scale: 0.98 }}
              className="relative max-h-[92vh] w-full overflow-auto rounded-t-[2rem] border border-border bg-white p-5 shadow-2xl sm:max-w-3xl sm:rounded-[2rem] sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-black text-ink">{bodyCompositionDraft.id ? 'Edit measurement' : 'New measurement'}</h3>
                  <p className="text-sm text-subtle">Keep the latest InBody scan handy for formula-based TDEE and history tracking.</p>
                </div>
                <button
                  onClick={() => setIsBodyCompositionModalOpen(false)}
                  className="rounded-xl border border-border px-3 py-2 text-sm font-bold text-subtle hover:bg-gray-50 hover:text-ink"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Measured at</label>
                  <input
                    type="date"
                    value={bodyCompositionDraft.measuredAt}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, measuredAt: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Source</label>
                  <input
                    value={bodyCompositionDraft.source}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, source: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                    placeholder="InBody"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={bodyCompositionDraft.weightKg}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, weightKg: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Body fat %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={bodyCompositionDraft.bodyFatPercent}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, bodyFatPercent: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Body fat mass (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={bodyCompositionDraft.bodyFatMassKg}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, bodyFatMassKg: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Skeletal muscle mass (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={bodyCompositionDraft.skeletalMuscleMassKg}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, skeletalMuscleMassKg: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Measured BMR (kcal)</label>
                  <input
                    type="number"
                    step="1"
                    value={bodyCompositionDraft.basalMetabolicRateKcal}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, basalMetabolicRateKcal: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Visceral fat level</label>
                  <input
                    type="number"
                    step="1"
                    value={bodyCompositionDraft.visceralFatLevel}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, visceralFatLevel: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">ECW ratio</label>
                  <input
                    type="number"
                    step="0.001"
                    value={bodyCompositionDraft.ecwRatio}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, ecwRatio: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Body cell mass (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={bodyCompositionDraft.bodyCellMassKg}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, bodyCellMassKg: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Notes</label>
                  <textarea
                    value={bodyCompositionDraft.notes}
                    onChange={(e) => setBodyCompositionDraft((current) => (current ? { ...current, notes: e.target.value } : current))}
                    rows={4}
                    className="mt-2 w-full rounded-[1.5rem] border border-border bg-white px-4 py-3 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-accent/20"
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => setIsBodyCompositionModalOpen(false)}
                  className="rounded-2xl border border-border bg-white px-4 py-2.5 text-sm font-black text-ink hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBodyCompositionMeasurement}
                  className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:opacity-95"
                >
                  Save measurement
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isBowelLogModalOpen && bowelMovementDraft ? (
          <div className="fixed inset-0 z-[220] flex items-end justify-center p-0 sm:items-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/60 backdrop-blur-md"
              onClick={() => setIsBowelLogModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 28, scale: 0.98 }}
              className="relative max-h-[92vh] w-full overflow-auto rounded-t-[2rem] border border-border bg-white p-5 shadow-2xl sm:max-w-2xl sm:rounded-[2rem] sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-subtle">Hidden log</div>
                  <h3 className="mt-1 text-xl font-black text-ink">Bowel log</h3>
                  <p className="text-sm text-subtle">Small, local-only entry for date, time, and notes.</p>
                </div>
                <div className="flex items-center gap-2">
                  {onOpenExportModal ? (
                    <button
                      onClick={() => onOpenExportModal('today', { dataType: 'bowel_movements', formatType: 'csv' })}
                      className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-subtle hover:text-ink hover:bg-gray-50"
                    >
                      Export CSV
                    </button>
                  ) : null}
                  <button
                    onClick={() => setIsBowelLogModalOpen(false)}
                    className="rounded-xl border border-border px-3 py-2 text-sm font-bold text-subtle hover:bg-gray-50 hover:text-ink"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Date</label>
                  <input
                    type="date"
                    value={bowelMovementDraft.date}
                    onChange={(e) => setBowelMovementDraft((current) => (current ? { ...current, date: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Time</label>
                  <input
                    type="time"
                    value={bowelMovementDraft.time}
                    onChange={(e) => setBowelMovementDraft((current) => (current ? { ...current, time: e.target.value } : current))}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-ink outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Notes</label>
                  <textarea
                    value={bowelMovementDraft.notes}
                    onChange={(e) => setBowelMovementDraft((current) => (current ? { ...current, notes: e.target.value } : current))}
                    rows={3}
                    className="mt-2 w-full rounded-[1.5rem] border border-border bg-white px-4 py-3 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-accent/20"
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              <div className="mt-5 rounded-[1.5rem] border border-border bg-gray-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-subtle">Recent entries</div>
                    <div className="mt-1 text-sm font-semibold text-subtle">Latest few logs stay easy to scan.</div>
                  </div>
                  <div className="text-xs font-semibold text-subtle">{bowelMovements.length} total</div>
                </div>
                <div className="mt-3 max-h-[260px] space-y-2 overflow-auto pr-1">
                  {bowelMovements.slice(0, 5).length > 0 ? (
                    bowelMovements.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-black text-ink">{formatBowelMovementDate(entry.occurredAt)}</div>
                            <MiniBadge label={formatBowelMovementTime(entry.occurredAt)} tone="bg-slate-50 text-slate-600 border-slate-100" />
                          </div>
                          <div className="mt-1 text-sm text-subtle">
                            {entry.notes?.trim() ? entry.notes : 'No notes.'}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => openBowelLogEditor(entry)}
                            className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-bold text-ink hover:bg-gray-50 transition-all"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDeleteBowelMovement(entry)}
                            className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-8 text-center text-sm text-subtle">
                      No bowel movement entries yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => setIsBowelLogModalOpen(false)}
                  className="rounded-2xl border border-border bg-white px-4 py-2.5 text-sm font-black text-ink hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBowelMovement}
                  className="rounded-2xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:opacity-95"
                >
                  Save entry
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

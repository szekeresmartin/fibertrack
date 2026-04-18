import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

// ─── Env ──────────────────────────────────────────────────────────────────────

const EDAMAM_APP_ID: string = (import.meta as any).env?.VITE_EDAMAM_APP_ID ?? '';
const EDAMAM_APP_KEY: string = (import.meta as any).env?.VITE_EDAMAM_APP_KEY ?? '';
const OPENAI_KEY: string = (import.meta as any).env?.VITE_OPENAI_API_KEY ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldSource = 'edamam' | 'ai';

interface NutrientSources {
  calories?: FieldSource;
  protein?: FieldSource;
  fat?: FieldSource;
  carbs?: FieldSource;
  total_fiber?: FieldSource;
  soluble_fiber?: FieldSource;
  insoluble_fiber?: FieldSource;
  sugar?: FieldSource;
  sodium?: FieldSource;
  cholesterol?: FieldSource;
  calcium?: FieldSource;
  iron?: FieldSource;
  potassium?: FieldSource;
  magnesium?: FieldSource;
}

interface NutritionResult {
  nameHu: string;
  nameEn: string;
  // Macros
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  // Fiber
  total_fiber: number | null;
  soluble_fiber: number | null;
  insoluble_fiber: number | null;
  // Extended
  sugar: number | null;
  sodium: number | null;
  cholesterol: number | null;
  calcium: number | null;
  iron: number | null;
  potassium: number | null;
  magnesium: number | null;
  // Meta
  sources: NutrientSources;
  source: 'cache' | 'edamam';
  usedOpenAI: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r1(n: number | null | undefined): number | null {
  if (n == null || isNaN(n)) return null;
  return Math.round(n * 10) / 10;
}

function fmt(n: number | null, unit = 'g'): string {
  return n != null ? `${n}${unit}` : '—';
}

// ─── 1. Cache lookup ──────────────────────────────────────────────────────────

async function lookupCache(query: string): Promise<NutritionResult | null> {
  const q = query.trim();
  const { data, error } = await supabase
    .from('foods')
    .select(`
      name_hu, name_en,
      calories, protein, carbs, fat,
      total_fiber, soluble_fiber, insoluble_fiber,
      sugar, sodium, cholesterol, calcium, iron, potassium, magnesium
    `)
    .or(`name_hu.ilike.${q},name_en.ilike.${q}`)
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    nameHu: data.name_hu ?? q,
    nameEn: data.name_en ?? q,
    calories: r1(data.calories),
    protein: r1(data.protein),
    fat: r1(data.fat),
    carbs: r1(data.carbs),
    total_fiber: r1(data.total_fiber),
    soluble_fiber: r1(data.soluble_fiber),
    insoluble_fiber: r1(data.insoluble_fiber),
    sugar: r1(data.sugar),
    sodium: r1(data.sodium),
    cholesterol: r1(data.cholesterol),
    calcium: r1(data.calcium),
    iron: r1(data.iron),
    potassium: r1(data.potassium),
    magnesium: r1(data.magnesium),
    sources: {},
    source: 'cache',
    usedOpenAI: false,
  };
}

// ─── 2. Edamam lookup ─────────────────────────────────────────────────────────

function parseInput(input: string): { foodName: string; grams: number } {
  const match = input.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (match) {
    const grams = parseFloat(match[1]);
    const foodName = input.replace(match[0], '').trim() || input.trim();
    return { foodName, grams };
  }
  return { foodName: input.trim(), grams: 100 };
}

// Edamam nutrient key → result field mapping
const EDAMAM_MAP: Array<[string, keyof NutrientSources]> = [
  ['ENERC_KCAL', 'calories'],
  ['PROCNT',     'protein'],
  ['FAT',        'fat'],
  ['CHOCDF',     'carbs'],
  ['FIBTG',      'total_fiber'],
  ['SUGAR',      'sugar'],
  ['NA',         'sodium'],
  ['CHOLE',      'cholesterol'],
  ['CA',         'calcium'],
  ['FE',         'iron'],
  ['K',          'potassium'],
  ['MG',         'magnesium'],
];

async function lookupEdamam(query: string): Promise<NutritionResult> {
  if (!EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
    throw new Error('VITE_EDAMAM_APP_ID or VITE_EDAMAM_APP_KEY is not set.');
  }

  const { foodName, grams } = parseInput(query.trim());
  const factor = grams / 100;

  const url = new URL('https://api.edamam.com/api/food-database/v2/parser');
  url.searchParams.set('app_id', EDAMAM_APP_ID);
  url.searchParams.set('app_key', EDAMAM_APP_KEY);
  url.searchParams.set('ingr', foodName);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Edamam error ${res.status}: ${body.slice(0, 120)}`);
  }

  const data = await res.json();
  const food = data.parsed?.[0]?.food ?? data.hints?.[0]?.food;
  if (!food) throw new Error('No food found. Try a simpler or English description.');

  const n: Record<string, number> = food.nutrients ?? {};
  console.log("NUTRIENTS:", n);

  const sources: NutrientSources = {};

  // Extract all available nutrients, scale by factor, track source
  const nutrientValues: Partial<Record<keyof NutrientSources, number | null>> = {};
  for (const [edamamKey, field] of EDAMAM_MAP) {
    const raw = n[edamamKey];
    const val = r1(raw != null ? raw * factor : null);
    nutrientValues[field] = val;
    if (val !== null) sources[field] = 'edamam';
  }

  return {
    nameHu: query.trim(),
    nameEn: food.label ?? query.trim(),
    calories:        nutrientValues.calories        ?? null,
    protein:         nutrientValues.protein         ?? null,
    fat:             nutrientValues.fat             ?? null,
    carbs:           nutrientValues.carbs           ?? null,
    total_fiber:     nutrientValues.total_fiber     ?? null,
    soluble_fiber:   null, // not in Edamam parser — filled by OpenAI if available
    insoluble_fiber: null, // not in Edamam parser — filled by OpenAI if available
    sugar:           nutrientValues.sugar           ?? null,
    sodium:          nutrientValues.sodium          ?? null,
    cholesterol:     nutrientValues.cholesterol     ?? null,
    calcium:         nutrientValues.calcium         ?? null,
    iron:            nutrientValues.iron            ?? null,
    potassium:       nutrientValues.potassium       ?? null,
    magnesium:       nutrientValues.magnesium       ?? null,
    sources,
    source: 'edamam',
    usedOpenAI: false,
  };
}

// ─── 3. OpenAI fallback (only for missing fields) ─────────────────────────────

async function fillWithOpenAI(result: NutritionResult): Promise<NutritionResult> {
  // Only call if soluble or insoluble fiber is missing
  if (!OPENAI_KEY) return result;
  if (result.soluble_fiber !== null && result.insoluble_fiber !== null) return result;

  try {
    const prompt =
      `Food: "${result.nameEn}"\n` +
      `Known nutrients: calories=${result.calories}, protein=${result.protein}g, ` +
      `fat=${result.fat}g, carbs=${result.carbs}g, total_fiber=${result.total_fiber}g\n\n` +
      `Estimate soluble and insoluble fiber for this food using realistic nutritional knowledge.\n` +
      `Rules:\n` +
      `- Do NOT default to 50/50 split\n` +
      `- Use known characteristics:\n` +
      `  - fruits → more soluble fiber\n` +
      `  - whole grains → more insoluble fiber\n` +
      `  - vegetables → often insoluble dominant\n` +
      `  - legumes → high in both but not equal\n` +
      `- Ensure: soluble + insoluble ≈ total fiber\n` +
      `- Prefer uneven splits (e.g. 70/30, 60/40)\n` +
      `- If uncertain: still avoid exact symmetry\n\n` +
      `Return JSON only: { "soluble_fiber": number, "insoluble_fiber": number }`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });
    if (!res.ok) return result;

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/```(?:json)?/g, '').trim());

    const soluble   = result.soluble_fiber   ?? r1(parsed.soluble_fiber   ?? null);
    const insoluble = result.insoluble_fiber ?? r1(parsed.insoluble_fiber ?? null);

    const sources = { ...result.sources };
    if (result.soluble_fiber   === null && soluble   !== null) sources.soluble_fiber   = 'ai';
    if (result.insoluble_fiber === null && insoluble !== null) sources.insoluble_fiber = 'ai';

    return { ...result, soluble_fiber: soluble, insoluble_fiber: insoluble, sources, usedOpenAI: true };
  } catch {
    return result; // fail silently — Edamam data is still valid
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminFoodGenerator() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<NutritionResult | null>(null);
  const [editNameHu, setEditNameHu] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = (text: string, ok: boolean) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), ok ? 3000 : 5000);
  };

  const handleGenerate = async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      // Step 1: check local DB cache
      const cached = await lookupCache(q);
      if (cached) {
        setResult(cached);
        setEditNameHu(cached.nameHu);
        setEditNameEn(cached.nameEn);
        return;
      }

      // Step 2: Edamam lookup
      let edamamResult = await lookupEdamam(q);

      // Step 3: OpenAI fills any missing fields (soluble/insoluble fiber)
      edamamResult = await fillWithOpenAI(edamamResult);

      setResult(edamamResult);
      setEditNameHu(edamamResult.nameHu);
      setEditNameEn(edamamResult.nameEn);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);

    console.log("FINAL RESULT", result);

    const { sources: src } = result;

    const { error: dbError } = await supabase.from('foods').insert({
      name_hu: editNameHu.trim() || result.nameHu,
      name_en: editNameEn.trim() || result.nameEn,
      // Nutrients
      calories:        result.calories,
      protein:         result.protein,
      carbs:           result.carbs,
      fat:             result.fat,
      total_fiber:     result.total_fiber,
      soluble_fiber:   result.soluble_fiber,
      insoluble_fiber: result.insoluble_fiber,
      sugar:           result.sugar,
      sodium:          result.sodium,
      cholesterol:     result.cholesterol,
      calcium:         result.calcium,
      iron:            result.iron,
      potassium:       result.potassium,
      magnesium:       result.magnesium,
      // Sources
      calories_source:        src.calories        ?? null,
      protein_source:         src.protein         ?? null,
      carbs_source:           src.carbs           ?? null,
      fat_source:             src.fat             ?? null,
      fiber_source:           src.total_fiber     ?? null,
      soluble_fiber_source:   src.soluble_fiber   ?? null,
      insoluble_fiber_source: src.insoluble_fiber ?? null,
    });

    setSaving(false);

    if (dbError) {
      showToast('Failed to save: ' + dbError.message, false);
    } else {
      showToast('Saved to database!', true);
      setQuery('');
      setResult(null);
    }
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.badge}>ADMIN</span>
        <h1 style={s.title}>Food Generator</h1>
        <p style={s.subtitle}>Local DB cache → Edamam → OpenAI (fiber)</p>
      </div>

      {/* Input */}
      <div style={s.inputRow}>
        <input
          style={s.input}
          type="text"
          placeholder="e.g. chicken breast 200g"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleGenerate()}
          disabled={loading}
          autoFocus
        />
        <button
          style={{
            ...s.btn,
            ...s.btnPrimary,
            opacity: loading || !query.trim() ? 0.55 : 1,
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
          }}
          onClick={handleGenerate}
          disabled={loading || !query.trim()}
        >
          {loading ? 'Looking up…' : 'Generate'}
        </button>
      </div>

      {/* Error */}
      {error && <div style={s.errorBox}>⚠️ {error}</div>}

      {/* Result card */}
      {result && (
        <div style={s.resultCard}>
          {/* Meta row */}
          <div style={s.resultMeta}>
            <span style={result.source === 'cache' ? s.badgeCache : s.badgeEdamam}>
              {result.source === 'cache' ? '✓ From database' : '⚡ Edamam API'}
            </span>
            {result.usedOpenAI && (
              <span style={s.badgeAI}>+ AI estimated fiber</span>
            )}
            <span style={s.resultName}>{result.nameHu}</span>
            {result.nameEn && result.nameEn !== result.nameHu && (
              <span style={s.resultNameEn}>{result.nameEn}</span>
            )}
          </div>

          {/* Editable Nutrients List */}
          <div style={s.nutrientsList}>
            {[
              { key: 'calories', label: 'Calories', unit: '' },
              { key: 'protein', label: 'Protein', unit: 'g' },
              { key: 'carbs', label: 'Carbs', unit: 'g' },
              { key: 'fat', label: 'Fat', unit: 'g' },
              { key: 'total_fiber', label: 'Fiber (total)', unit: 'g' },
              { key: 'soluble_fiber', label: 'Soluble fiber', unit: 'g', ai: true },
              { key: 'insoluble_fiber', label: 'Insoluble fiber', unit: 'g', ai: true },
              { key: 'sugar', label: 'Sugar', unit: 'g' },
              { key: 'sodium', label: 'Sodium', unit: 'mg' },
              { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
              { key: 'calcium', label: 'Calcium', unit: 'mg' },
              { key: 'iron', label: 'Iron', unit: 'mg' },
              { key: 'potassium', label: 'Potassium', unit: 'mg' },
              { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
            ]
              .filter((field) => result[field.key as keyof NutritionResult] != null)
              .map((field) => {
                const k = field.key as keyof NutritionResult;
                const val = result[k] as number;
                const isAI = field.ai && result.sources[k as keyof NutrientSources] === 'ai';

                return (
                  <div style={s.nutrientRow} key={field.key}>
                    <div style={s.nutrientLabel}>
                      {field.label}
                      {isAI && <span style={s.aiBadgeLabel}>AI</span>}
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      value={val === null || isNaN(val) ? '' : val}
                      onChange={(e) => {
                        const num = parseFloat(e.target.value);
                        setResult((prev) =>
                          prev ? { ...prev, [k]: isNaN(num) ? 0 : num } : prev
                        );
                      }}
                      style={{ ...s.nutrientInput, ...(isAI ? s.aiText : {}) }}
                    />
                    <div style={s.nutrientUnit}>{field.unit}</div>
                  </div>
                );
              })}
          </div>

          {/* Edit Names */}
          {result.source === 'edamam' && (
            <div style={s.editNamesWrapper}>
              <div style={s.editField}>
                <label style={s.editLabel}>Hungarian name</label>
                <input
                  style={s.input}
                  value={editNameHu}
                  onChange={(e) => setEditNameHu(e.target.value)}
                />
              </div>
              <div style={s.editField}>
                <label style={s.editLabel}>English name</label>
                <input
                  style={s.input}
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={s.actionRow}>
            {result.source === 'edamam' && (
              <button
                style={{
                  ...s.btn,
                  ...s.btnSave,
                  opacity: saving ? 0.55 : 1,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save to database'}
              </button>
            )}
            <button
              style={{ ...s.btn, ...s.btnGhost }}
              onClick={handleGenerate}
              disabled={loading}
            >
              Regenerate
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            ...s.toast,
            background: toast.ok ? '#dcfce7' : '#fee2e2',
            color: toast.ok ? '#166534' : '#991b1b',
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#ffffff',
    color: '#111111',
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: '24px 16px 80px',
    maxWidth: 700,
    margin: '0 auto',
  },
  header: {
    marginBottom: 28,
    paddingTop: 12,
  },
  badge: {
    display: 'inline-block',
    background: '#f1f1f1',
    color: '#555555',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid #d4d4d4',
    marginBottom: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#111111',
    margin: '0 0 4px',
  },
  subtitle: {
    fontSize: 13,
    color: '#555555',
    margin: 0,
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 20,
  },
  input: {
    flex: 1,
    background: '#ffffff',
    border: '1px solid #cccccc',
    borderRadius: 8,
    padding: '13px 16px',
    color: '#111111',
    fontSize: 15,
    outline: 'none',
  },
  btn: {
    border: 'none',
    borderRadius: 8,
    padding: '13px 20px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'opacity 0.15s',
  },
  btnPrimary: {
    background: '#2563eb',
    color: '#ffffff',
  },
  btnSave: {
    background: '#16a34a',
    color: '#ffffff',
    flex: 1,
  },
  btnGhost: {
    background: '#f1f1f1',
    color: '#333333',
    border: '1px solid #cccccc',
  },
  errorBox: {
    background: '#fff5f5',
    border: '1px solid #fca5a5',
    borderRadius: 8,
    padding: '14px 16px',
    color: '#b91c1c',
    fontSize: 14,
    marginBottom: 16,
  },
  resultCard: {
    background: '#f8f8f8',
    border: '1px solid #dddddd',
    borderRadius: 10,
    padding: '18px',
    marginBottom: 16,
  },
  resultMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  resultName: {
    fontSize: 16,
    fontWeight: 700,
    color: '#111111',
  },
  resultNameEn: {
    fontSize: 12,
    color: '#888888',
    fontStyle: 'italic',
  },
  badgeCache: {
    display: 'inline-block',
    background: '#dcfce7',
    color: '#166534',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  },
  badgeEdamam: {
    display: 'inline-block',
    background: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  },
  badgeAI: {
    display: 'inline-block',
    background: '#fef9c3',
    color: '#854d0e',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#555555',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    margin: '20px 0 10px 4px',
  },
  nutrientsList: {
    background: '#ffffff',
    border: '1px solid #dddddd',
    borderRadius: 8,
    padding: '16px 16px 8px 16px',
    marginBottom: 16,
  },
  nutrientRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  nutrientLabel: {
    flex: 1,
    fontWeight: 500,
    fontSize: 14,
    color: '#333333',
    display: 'flex',
    alignItems: 'center',
  },
  nutrientInput: {
    width: 80,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #cccccc',
    textAlign: 'right',
    fontSize: 14,
    fontWeight: 600,
    color: '#111111',
    outline: 'none',
  },
  nutrientUnit: {
    width: 36,
    textAlign: 'right',
    fontSize: 14,
    color: '#888888',
  },
  aiBadgeLabel: {
    marginLeft: 8,
    fontSize: 10,
    fontWeight: 700,
    color: '#b45309',
    background: '#fef3c7',
    padding: '2px 6px',
    borderRadius: 4,
  },
  aiText: {
    color: '#854d0e',
    fontStyle: 'italic',
  },
  actionRow: {
    display: 'flex',
    gap: 10,
    marginTop: 4,
  },
  editNamesWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginTop: 10,
    marginBottom: 16,
    paddingTop: 16,
    borderTop: '1px solid #eeeeee',
  },
  editField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  editLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#555555',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  toast: {
    position: 'fixed',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    borderRadius: 999,
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 700,
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    zIndex: 9999,
    whiteSpace: 'nowrap',
  },
};

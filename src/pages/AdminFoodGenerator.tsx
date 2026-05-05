import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

// ─── Env ──────────────────────────────────────────────────────────────────────

// ─── Env ──────────────────────────────────────────────────────────────────────

const OPENAI_KEY: string = (import.meta as any).env?.VITE_OPENAI_API_KEY ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldSource = 'ai' | 'manual';

interface NutrientSources {
  calories?: FieldSource;
  protein?: FieldSource;
  fat?: FieldSource;
  carbs?: FieldSource;
  total_fiber?: FieldSource;
  soluble_fiber?: FieldSource;
  insoluble_fiber?: FieldSource;
  gi?: FieldSource;
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
  brand: string | null;
  // Macros
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  // Fiber
  total_fiber: number | null;
  soluble_fiber: number | null;
  insoluble_fiber: number | null;
  gi: number | null;
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
  source: 'cache' | 'manual';
  usedOpenAI: boolean;
  category: 'vegetable' | 'other';
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
      name_hu, name_en, brand,
      calories, protein, carbs, fat,
      total_fiber, soluble_fiber, insoluble_fiber, gi,
      sugar, sodium, cholesterol, calcium, iron, potassium, magnesium,
      category
    `)
    .or(`name_hu.ilike.${q},name_en.ilike.${q}`)
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    nameHu: data.name_hu ?? q,
    nameEn: data.name_en ?? q,
    brand: data.brand ?? null,
    calories: r1(data.calories),
    protein: r1(data.protein),
    fat: r1(data.fat),
    carbs: r1(data.carbs),
    total_fiber: r1(data.total_fiber),
    soluble_fiber: r1(data.soluble_fiber),
    insoluble_fiber: r1(data.insoluble_fiber),
    gi: r1(data.gi),
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
    category: data.category ?? 'other',
  };
}

// ─── 2. OpenAI fallback (only for missing fields) ─────────────────────────────

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
    return result; 
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminFoodGenerator() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<NutritionResult | null>(null);
  const [editNameHu, setEditNameHu] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');

  const showToast = (text: string, ok: boolean) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), ok ? 3000 : 5000);
  };

  const initManualEntry = () => {
    const emptyResult: NutritionResult = {
      nameHu: '',
      nameEn: '',
      brand: null,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      total_fiber: 0,
      soluble_fiber: 0,
      insoluble_fiber: 0,
      gi: 0,
      sugar: 0,
      sodium: 0,
      cholesterol: 0,
      calcium: 0,
      iron: 0,
      potassium: 0,
      magnesium: 0,
      sources: {
        calories: 'manual',
        protein: 'manual',
        fat: 'manual',
        carbs: 'manual',
        total_fiber: 'manual',
        soluble_fiber: 'manual',
        insoluble_fiber: 'manual',
        gi: 'manual',
      },
      source: 'manual',
      usedOpenAI: false,
      category: 'other',
    };
    setResult(emptyResult);
    setEditNameHu('');
    setEditNameEn('');
    setEditBrand('');
    setError(null);
  };

  const handleModeChange = (newMode: 'auto' | 'manual') => {
    setMode(newMode);
    if (newMode === 'manual') {
      initManualEntry();
    } else {
      setResult(null);
      setQuery('');
    }
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
        setEditBrand(cached.brand ?? '');
      } else {
        setError('Food not found in local database.');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;

    // Validation
    const name = editNameHu.trim() || (result.source !== 'manual' ? result.nameHu : '');
    if (!name) {
      showToast('Hungarian name is required', false);
      return;
    }

    // Verify all numeric values are >= 0
    const nutrients = [
      'calories', 'protein', 'carbs', 'fat', 'total_fiber', 
      'soluble_fiber', 'insoluble_fiber', 'gi', 'sugar', 
      'sodium', 'cholesterol', 'calcium', 'iron', 'potassium', 'magnesium'
    ];
    for (const key of nutrients) {
      const val = result[key as keyof NutritionResult] as number | null;
      if (val !== null && val < 0) {
        showToast(`${key} must be 0 or greater`, false);
        return;
      }
    }

    setSaving(true);
    console.log("FINAL RESULT", result);

    const { sources: src } = result;

    const { error: dbError } = await supabase.from('foods').insert({
      name_hu: name,
      name_en: editNameEn.trim() || result.nameEn,
      brand: editBrand.trim() || null,
      // Nutrients
      calories:        result.calories,
      protein:         result.protein,
      carbs:           result.carbs,
      fat:             result.fat,
      total_fiber:     result.total_fiber,
      soluble_fiber:   result.soluble_fiber,
      insoluble_fiber: result.insoluble_fiber,
      gi:              result.gi,
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
      category:               result.category,
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
        <p style={s.subtitle}>Local DB cache → OpenAI (fiber)</p>
      </div>

      {/* Mode Toggle */}
      <div style={s.toggleWrapper}>
        <button
          style={{
            ...s.toggleBtn,
            ...(mode === 'auto' ? s.toggleBtnActive : {}),
          }}
          onClick={() => handleModeChange('auto')}
        >
          Auto (Search)
        </button>
        <button
          style={{
            ...s.toggleBtn,
            ...(mode === 'manual' ? s.toggleBtnActive : {}),
          }}
          onClick={() => handleModeChange('manual')}
        >
          Manual
        </button>
      </div>

      {/* Input */}
      {mode === 'auto' && (
        <div style={s.inputRow}>
          <input
            style={s.input}
            type="text"
            placeholder="Search for existing food..."
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
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && <div style={s.errorBox}>⚠️ {error}</div>}

      {/* Result card */}
      {result && (
        <div style={s.resultCard}>
          {/* Meta row */}
          <div style={s.resultMeta}>
            {result.source === 'cache' && (
              <span style={s.badgeCache}>✓ From database</span>
            )}
            {result.source === 'manual' && (
              <span style={s.badgeManual}>✍️ Manual Entry</span>
            )}
            {result.usedOpenAI && (
              <span style={s.badgeAI}>+ AI estimated fiber</span>
            )}
            {result.source !== 'manual' && (
              <>
                <span style={s.resultName}>{result.nameHu}</span>
                {result.nameEn && result.nameEn !== result.nameHu && (
                  <span style={s.resultNameEn}>{result.nameEn}</span>
                )}
              </>
            )}
            {result.source === 'manual' && (
              <span style={s.resultName}>New Item</span>
            )}
            
            {/* Category Toggle */}
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button 
                onClick={() => setResult(prev => prev ? { ...prev, category: 'vegetable' } : null)}
                style={{
                  ...s.badge,
                  marginBottom: 0,
                  cursor: 'pointer',
                  background: result.category === 'vegetable' ? '#16a34a' : '#f1f1f1',
                  color: result.category === 'vegetable' ? '#ffffff' : '#555555',
                  borderColor: result.category === 'vegetable' ? '#16a34a' : '#d4d4d4',
                  opacity: 1,
                }}
              >
                Vegetable
              </button>
              <button 
                onClick={() => setResult(prev => prev ? { ...prev, category: 'other' } : null)}
                style={{
                  ...s.badge,
                  marginBottom: 0,
                  cursor: 'pointer',
                  background: result.category === 'other' ? '#555555' : '#f1f1f1',
                  color: result.category === 'other' ? '#ffffff' : '#555555',
                  borderColor: result.category === 'other' ? '#555555' : '#d4d4d4',
                  opacity: 1,
                }}
              >
                Other
              </button>
            </div>
          </div>

          {/* Editable Nutrients List */}
          <div style={s.nutrientsList}>
            {[
              { key: 'calories', label: 'Calories', unit: '' },
              { key: 'protein', label: 'Protein', unit: 'g' },
              { key: 'carbs', label: 'Carbs', unit: 'g' },
              { key: 'fat', label: 'Fat', unit: 'g' },
              { key: 'total_fiber', label: 'Fiber (total)', unit: 'g' },
              { key: 'gi', label: 'Glycemic Index (GI)', unit: '' },
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
              .filter((field) => 
                result[field.key as keyof NutritionResult] != null || 
                ['gi', 'soluble_fiber', 'insoluble_fiber'].includes(field.key) ||
                mode === 'manual'
              )
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
          {(result.source === 'cache' || result.source === 'manual') && (
            <div style={s.editNamesWrapper}>
              <div style={s.editField}>
                <label style={s.editLabel}>Hungarian name (required)</label>
                <input
                  style={s.input}
                  placeholder="e.g. Alma"
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
              <div style={s.editField}>
                <label style={s.editLabel}>Brand</label>
                <input
                  style={s.input}
                  placeholder="e.g. Lidl, Tesco"
                  value={editBrand}
                  onChange={(e) => setEditBrand(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={s.actionRow}>
            {(result.source === 'cache' || result.source === 'manual') && (
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
            {mode === 'auto' && (
              <button
                style={{ ...s.btn, ...s.btnGhost }}
                onClick={handleGenerate}
                disabled={loading}
              >
                Refresh
              </button>
            )}
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
  toggleWrapper: {
    display: 'flex',
    background: '#f1f1f1',
    padding: 4,
    borderRadius: 8,
    marginBottom: 20,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    color: '#666666',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  toggleBtnActive: {
    background: '#ffffff',
    color: '#111111',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.05)',
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
  badgeManual: {
    display: 'inline-block',
    background: '#f3e8ff',
    color: '#7e22ce',
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

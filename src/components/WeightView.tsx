import { useMemo, useRef, useState, type FormEvent } from 'react';
import { format, subDays } from 'date-fns';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useUpsertWeightLog, useWeightLogs } from '../lib/queries/weightQueries';
import { normalizeDateToLocal, parseLocalDateInput } from '../lib/dateUtils';

interface WeightViewProps {
  userId: string;
}

type ChartPeriod = '30' | '90' | 'all';

const dateFormatter = new Intl.DateTimeFormat('hu-HU', {
  year: 'numeric', month: 'short', day: 'numeric',
});
const shortDateFormatter = new Intl.DateTimeFormat('hu-HU', {
  month: 'short', day: 'numeric',
});
const weightFormatter = new Intl.NumberFormat('hu-HU', {
  maximumFractionDigits: 2,
});

function displayDate(date: string, short = false) {
  const parsed = parseLocalDateInput(date);
  if (!parsed) return date;
  return (short ? shortDateFormatter : dateFormatter).format(parsed);
}

export default function WeightView({ userId }: WeightViewProps) {
  const today = normalizeDateToLocal(new Date());
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState('');
  const [period, setPeriod] = useState<ChartPeriod>('90');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const weightInputRef = useRef<HTMLInputElement>(null);
  const { data: weightLogs = [], isLoading, isError } = useWeightLogs(userId);
  const saveWeight = useUpsertWeightLog();

  const entries = useMemo(
    () => weightLogs.filter((entry) => Number.isFinite(Number(entry.weight)) && Number(entry.weight) > 0)
      .slice().sort((a, b) => b.date.localeCompare(a.date)),
    [weightLogs],
  );

  const chartData = useMemo(() => {
    const cutoff = period === 'all' ? null : format(subDays(new Date(), Number(period) - 1), 'yyyy-MM-dd');
    return entries.filter((entry) => !cutoff || entry.date >= cutoff)
      .map((entry) => ({ date: entry.date, weight: Number(entry.weight) }))
      .reverse();
  }, [entries, period]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedWeight = Number(weight.trim().replace(',', '.'));
    if (!date || !Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setMessage({ text: 'Adj meg egy dátumot és egy pozitív súlyt.', error: true });
      return;
    }

    try {
      await saveWeight.mutateAsync({ userId, date, weight: parsedWeight });
      setMessage({ text: 'A súlyt elmentettem.', error: false });
    } catch {
      setMessage({ text: 'A mentés nem sikerült. Próbáld újra.', error: true });
    }
  };

  const editEntry = (entryDate: string, entryWeight: number) => {
    setDate(entryDate);
    setWeight(String(entryWeight));
    setMessage(null);
    weightInputRef.current?.focus();
  };

  return (
    <div className="h-full overflow-y-auto pb-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Súlynapló</h1>
          <p className="mt-1 text-sm text-subtle">Rögzítsd a súlyodat, és kövesd az alakulását.</p>
        </div>

        <section className="rounded-3xl border border-border bg-white p-5 shadow-sm sm:p-6" aria-labelledby="weight-entry-title">
          <h2 id="weight-entry-title" className="mb-4 text-base font-bold text-ink">Súly felvitele</h2>
          <form onSubmit={handleSave} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-medium text-ink">
              Dátum
              <input type="date" required max={today} value={date} onChange={(event) => { setDate(event.target.value); setMessage(null); }} className="mt-1 block w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink focus:border-accent focus:outline-none" />
            </label>
            <label className="flex-1 text-sm font-medium text-ink">
              Súly (kg)
              <input ref={weightInputRef} type="text" inputMode="decimal" required value={weight} onChange={(event) => { setWeight(event.target.value); setMessage(null); }} placeholder="pl. 72,5" className="mt-1 block w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink focus:border-accent focus:outline-none" />
            </label>
            <button type="submit" disabled={saveWeight.isPending} className="rounded-xl bg-accent px-6 py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
              {saveWeight.isPending ? 'Mentés…' : 'Mentés'}
            </button>
          </form>
          {message && <p role={message.error ? 'alert' : 'status'} className={'mt-3 text-sm ' + (message.error ? 'text-red-600' : 'text-green-700')}>{message.text}</p>}
        </section>

        <section className="rounded-3xl border border-border bg-white p-5 shadow-sm sm:p-6" aria-labelledby="weight-chart-title">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 id="weight-chart-title" className="text-base font-bold text-ink">Súly alakulása</h2>
            <div className="flex rounded-xl bg-bg p-1" aria-label="Grafikon időszaka">
              {([['30', '30 nap'], ['90', '90 nap'], ['all', 'Összes']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setPeriod(value)} aria-pressed={period === value} className={'rounded-lg px-3 py-1.5 text-xs font-semibold ' + (period === value ? 'bg-white text-accent shadow-sm' : 'text-subtle hover:text-ink')}>{label}</button>
              ))}
            </div>
          </div>
          {chartData.length ? (
            <div className="h-64 w-full sm:h-72" role="img" aria-label="Súlyváltozás grafikon">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: -15, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(value: string) => displayDate(value, true)} tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis domain={['dataMin - 1', 'dataMax + 1']} tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={48} unit=" kg" />
                  <Tooltip labelFormatter={(value) => displayDate(String(value))} formatter={(value) => [weightFormatter.format(Number(value)) + ' kg', 'Súly']} />
                  <Line type="monotone" dataKey="weight" stroke="#15803D" strokeWidth={2.5} dot={chartData.length <= 45 ? { r: 3, fill: '#15803D' } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-16 text-center text-sm text-subtle">Ebben az időszakban még nincs rögzített súly.</p>}
        </section>

        <section className="rounded-3xl border border-border bg-white p-5 shadow-sm sm:p-6" aria-labelledby="weight-history-title">
          <h2 id="weight-history-title" className="mb-1 text-base font-bold text-ink">Korábbi mérések</h2>
          <p className="mb-4 text-xs text-subtle">A legújabb tíz bejegyzés fér ki; a többi itt görgethető. Szerkesztéshez koppints a dátumra.</p>
          <div className="max-h-[484px] overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg text-left text-xs text-subtle">
                <tr className="h-11"><th scope="col" className="px-4 py-2 font-semibold">Dátum</th><th scope="col" className="px-4 py-2 text-right font-semibold">Súly</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? <tr><td colSpan={2} className="px-4 py-8 text-center text-subtle">Betöltés…</td></tr>
                  : isError ? <tr><td colSpan={2} className="px-4 py-8 text-center text-red-600">A súlyadatok nem tölthetők be.</td></tr>
                  : entries.length === 0 ? <tr><td colSpan={2} className="px-4 py-8 text-center text-subtle">Még nincs rögzített súly.</td></tr>
                  : entries.map((entry) => (
                    <tr key={entry.date} className="h-11">
                      <td className="px-4 py-2 text-ink"><button type="button" onClick={() => editEntry(entry.date, Number(entry.weight))} className="text-left font-medium text-accent hover:underline" aria-label={displayDate(entry.date) + ' súlyának szerkesztése'}>{displayDate(entry.date)}</button></td>
                      <td className="px-4 py-2 text-right font-semibold text-ink">{weightFormatter.format(Number(entry.weight))} kg</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

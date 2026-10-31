import { Badge, Button, Card, Input, Select, Switch, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageTitle, Section } from '../components/kit';
import { ApiError, get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, rub } from '../lib/format';

interface Prize { id: string; label: string; type: 'days' | 'balance'; value: number; weight: number }
interface Resp {
  settings: { enabled: boolean; prizes: Prize[] };
  stats: { total: number; today: number; daysGiven: number; kopeksGiven: number };
  byPrize: Record<string, number>;
  recent: { prize_label: string; prize_type: string; prize_value: number; created_at: string; username: string | null; first_name: string | null; tg_id: number | null }[];
}
/** Строка формы: значение хранится строкой (дни или рубли), вес — строкой */
interface Row { id: string; label: string; type: 'days' | 'balance'; value: string; weight: string; auto: boolean }

const DEFAULTS: Prize[] = [
  { id: 'd1', label: '+1 день', type: 'days', value: 1, weight: 30 },
  { id: 'b3', label: '+3 ₽', type: 'balance', value: 300, weight: 26 },
  { id: 'd2', label: '+2 дня', type: 'days', value: 2, weight: 18 },
  { id: 'b5', label: '+5 ₽', type: 'balance', value: 500, weight: 14 },
  { id: 'd3', label: '+3 дня', type: 'days', value: 3, weight: 7 },
  { id: 'b10', label: '+10 ₽', type: 'balance', value: 1000, weight: 3 },
  { id: 'd7', label: '+7 дней', type: 'days', value: 7, weight: 1 },
  { id: 'b30', label: '+30 ₽', type: 'balance', value: 3000, weight: 1 },
];
const pluralDays = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней');
const autoLabel = (type: Row['type'], value: string) => { const n = Number(value.replace(',', '.')); if (!(n > 0)) return ''; return type === 'days' ? `+${Math.round(n)} ${pluralDays(Math.round(n))}` : `+${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`; };
const toRows = (p: Prize[]): Row[] => p.map((x) => { const value = x.type === 'balance' ? String(x.value / 100) : String(x.value); return { id: x.id, label: x.label, type: x.type, value, weight: String(x.weight), auto: x.label === autoLabel(x.type, value) }; });
const num = (s: string) => Number(s.replace(',', '.'));
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

export default function WheelPage() {
  const { can } = useAuth();
  const canEdit = can('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['wheel'], queryFn: () => get<Resp>('/wheel') });
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data && !dirty) { setEnabled(q.data.settings.enabled); setRows(toRows(q.data.settings.prizes)); } }, [q.data, dirty]);

  const upd = (i: number, patch: Partial<Row>) => { setDirty(true); setRows((r) => r.map((x, k) => { if (k !== i) return x; const n = { ...x, ...patch }; if (n.auto && ('type' in patch || 'value' in patch)) n.label = autoLabel(n.type, n.value); return n; })); };
  const add = () => { setDirty(true); setRows((r) => [...r, { id: 'p' + Math.random().toString(36).slice(2, 8), label: '+1 день', type: 'days', value: '1', weight: '10', auto: true }]); };
  const del = (i: number) => { setDirty(true); setRows((r) => r.filter((_, k) => k !== i)); };

  const totalW = rows.reduce((s, r) => s + (num(r.weight) > 0 ? num(r.weight) : 0), 0);
  const avg = useMemo(() => {
    if (!totalW) return { days: 0, rub: 0 };
    let d = 0, k = 0;
    for (const r of rows) { const w = num(r.weight) || 0, v = num(r.value) || 0; if (r.type === 'days') d += (w / totalW) * v; else k += (w / totalW) * v; }
    return { days: d, rub: k };
  }, [rows, totalW]);

  const problem = rows.length < 2 ? 'Нужно минимум 2 приза' : rows.length > 12 ? 'Не больше 12 призов' : rows.some((r) => !r.label.trim() || r.label.length > 24) ? 'У каждого приза нужна подпись до 24 символов' : rows.some((r) => !(num(r.value) > 0) || (r.type === 'days' && !Number.isInteger(num(r.value)))) ? 'Укажите положительное значение (дни — целое число)' : rows.some((r) => !Number.isInteger(num(r.weight)) || num(r.weight) < 1 || num(r.weight) > 1000) ? 'Вес — целое число от 1 до 1000' : null;

  const save = useMutation({
    mutationFn: () => put('/wheel', { enabled, prizes: rows.map((r) => ({ id: r.id, label: r.label.trim(), type: r.type, value: r.type === 'balance' ? Math.round(num(r.value) * 100) : Math.round(num(r.value)), weight: Math.round(num(r.weight)) })) }),
    onSuccess: () => { setDirty(false); void qc.invalidateQueries({ queryKey: ['wheel'] }); toast('Колесо сохранено', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const st = q.data?.stats;
  return (
    <div className="animate-fade-up space-y-5">
      <PageTitle title="Колесо удачи" subtitle="Призы и шансы выпадения. Один бесплатный прокрут в сутки на пользователя (сброс в полночь по Москве)." />
      {st && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Прокрутов всего', st.total], ['Сегодня', st.today], ['Выдано дней', st.daysGiven], ['Выдано на баланс', rub(st.kopeksGiven)]].map(([l, v]) => (
            <Card key={String(l)} className="p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 text-xl font-bold">{v}</div></Card>
          ))}
        </div>
      )}

      <Section title="Призы" description="Шанс приза = его вес ÷ сумма всех весов. Результат определяет сервер, подделать его на клиенте нельзя." right={<Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Включено' : 'Выключено'}</Badge>}>
        <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-4"><div><div className="text-sm font-medium">Колесо включено</div><div className="text-xs text-muted">Если выключить, раздел пропадёт из мини-аппа</div></div><Switch checked={enabled} onChange={(v) => { setEnabled(v); setDirty(true); }} label="Колесо включено" /></div>

          <div className="space-y-2">
            <div className="hidden grid-cols-[1.4fr_1.1fr_.8fr_.7fr_.6fr_auto] gap-2 px-1 text-xs text-muted md:grid"><span>Подпись на колесе</span><span>Тип</span><span>Значение</span><span>Вес</span><span>Шанс</span><span /></div>
            {rows.map((r, i) => {
              const chance = totalW && num(r.weight) > 0 ? (num(r.weight) / totalW) * 100 : 0;
              const won = q.data?.byPrize[r.id] ?? 0;
              return (
                <div key={r.id} className="grid grid-cols-2 items-center gap-2 rounded-btn border border-border p-2.5 md:grid-cols-[1.4fr_1.1fr_.8fr_.7fr_.6fr_auto] md:border-0 md:p-0">
                  <Input className="col-span-2 md:col-span-1" value={r.label} maxLength={24} onChange={(e) => upd(i, { label: e.target.value, auto: false })} aria-label="Подпись" />
                  <Select value={r.type} onChange={(e) => upd(i, { type: e.target.value as Row['type'] })} aria-label="Тип"><option value="days">Дни подписки</option><option value="balance">Баланс, ₽</option></Select>
                  <Input type="number" min={r.type === 'days' ? 1 : 0.01} step={r.type === 'days' ? 1 : 0.01} value={r.value} onChange={(e) => upd(i, { value: e.target.value })} aria-label="Значение" />
                  <Input type="number" min={1} max={1000} step={1} value={r.weight} onChange={(e) => upd(i, { weight: e.target.value })} aria-label="Вес" />
                  <div className="text-sm"><b>{chance.toFixed(chance < 10 ? 1 : 0)}%</b>{won > 0 && <span className="ml-1.5 text-xs text-muted">выпало {won}</span>}</div>
                  <Button type="button" size="sm" variant="ghost" aria-label="Удалить приз" icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => del(i)} disabled={rows.length <= 2} />
                </div>
              );
            })}
          </div>

          <div className="rounded-btn bg-surface-2 p-3.5 text-sm">
            В среднем за прокрут: <b>{avg.days.toFixed(2)} дн.</b> подписки и <b>{avg.rub.toFixed(2)} ₽</b> на баланс. Умножьте на число активных пользователей в день, чтобы оценить расходы.
          </div>
          {problem && <div className="text-sm text-danger">{problem}</div>}

          <div className="flex flex-wrap gap-3">
            <Button type="button" loading={save.isPending} disabled={!dirty || Boolean(problem)} onClick={() => save.mutate()}>Сохранить</Button>
            <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={rows.length >= 12} onClick={add}>Добавить приз</Button>
            <Button type="button" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { if (confirm('Вернуть стандартный набор призов?')) { setRows(toRows(DEFAULTS)); setDirty(true); } }}>Стандартные</Button>
          </div>
        </fieldset>
      </Section>

      <Section title="Последние выигрыши">
        {q.data?.recent.length ? (
          <div className="divide-y divide-border text-sm">
            {q.data.recent.map((x, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 truncate">{x.username ? '@' + x.username : x.first_name ?? x.tg_id ?? 'пользователь'}</span><span className="shrink-0 font-semibold">{x.prize_label}</span><span className="shrink-0 text-xs text-muted">{fmtDateTime(x.created_at)}</span></div>
            ))}
          </div>
        ) : <div className="text-sm text-muted">Пока никто не крутил колесо.</div>}
      </Section>
    </div>
  );
}

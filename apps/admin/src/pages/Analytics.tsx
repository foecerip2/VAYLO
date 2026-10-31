import { Card } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, get } from '../lib/api';

interface Totals { gross: number; refunds: number; net: number }
interface Overview { enabled: boolean; revenue?: { totals: Record<string, Totals>; payingUsers: number; arppu: Record<string, number | null>; series: { bucket: string; currency: string; net: number }[]; dataAsOf: string }; mrr?: { byCurrency: Record<string, { mrr: number; subscriptions: number }> } }
interface Funnel { stages: { stage: string; users: number; source: string }[]; note: string }
interface Cohorts { cohorts: { cohort: string; size: number; retention: (number | null)[] }[]; method: string }
const STAGE: Record<string, string> = { bot_start: 'Старт бота', miniapp_open: 'Открыли Mini App', trial_started: 'Пробный период', checkout_started: 'Начали оплату', payment_succeeded: 'Оплатили', access_fulfilled: 'Доступ выдан', renewed: 'Продлили' };
const rub = (v: number, cur: string) => `${(v / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${cur === 'RUB' ? '₽' : cur}`;

export default function Analytics() {
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const q = `from=${encodeURIComponent(from)}`;
  const ov = useQuery({ queryKey: ['an-ov', days], queryFn: () => get<Overview>(`/analytics/overview?${q}`) });
  const fn = useQuery({ queryKey: ['an-fn', days], queryFn: () => get<Funnel>(`/analytics/funnel?${q}`), enabled: ov.data?.enabled });
  const co = useQuery({ queryKey: ['an-co'], queryFn: () => get<Cohorts>('/analytics/cohorts'), enabled: ov.data?.enabled });
  if (ov.isLoading) return <div className="space-y-3"><PageTitle title="Аналитика" /><Sk className="h-40" /></div>;
  if (ov.isError) return <div className="space-y-3"><PageTitle title="Аналитика" /><Empty title="Не удалось загрузить" text={ov.error instanceof ApiError ? ov.error.message : 'Ошибка'} /></div>;
  if (!ov.data!.enabled) return <div className="space-y-3"><PageTitle title="Аналитика" /><Card className="p-4 text-sm text-muted">Модуль выключен (PRODUCT_ANALYTICS_ENABLED=false).</Card></div>;
  const r = ov.data!.revenue!;
  const max = Math.max(1, ...(fn.data?.stages.map((s) => s.users) ?? [1]));
  return (
    <div className="space-y-5">
      <PageTitle title="Аналитика" />
      <select aria-label="Период" className="rounded-xl border border-fg/10 bg-transparent p-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select>
      <Section title="Выручка (по платежам)">
        {!Object.keys(r.totals).length ? <Empty title="Платежей за период нет" /> : (
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries(r.totals).map(([cur, t]) => (
            <Card key={cur} className="p-4 text-sm"><div className="text-xs text-muted">{cur}</div><div className="text-2xl font-semibold">{rub(t.net, cur)}</div>
              <div className="text-xs text-muted">gross {rub(t.gross, cur)} · возвраты {rub(t.refunds, cur)} · ARPPU {r.arppu[cur] == null ? '—' : rub(r.arppu[cur]!, cur)}</div></Card>))}</div>
        )}
        <p className="mt-2 text-xs text-muted">Платящих: {r.payingUsers}. Комиссии провайдеров не учтены. Данные на {new Date(r.dataAsOf).toLocaleString('ru-RU')}.</p>
        {Object.entries(ov.data!.mrr?.byCurrency ?? {}).map(([cur, m]) => <p key={cur} className="text-xs text-muted">MRR (оценка, не бухучёт): {rub(m.mrr, cur)} · активных платных подписок {m.subscriptions}</p>)}
      </Section>
      <Section title="Воронка">
        <div className="space-y-2">{fn.data?.stages.map((s) => (
          <div key={s.stage} className="text-sm"><div className="flex justify-between"><span>{STAGE[s.stage] ?? s.stage}</span><b>{s.users}</b></div>
            <div className="h-2 rounded-full bg-fg/10" role="img" aria-label={`${STAGE[s.stage]}: ${s.users}`}><div className="h-2 rounded-full bg-primary" style={{ width: `${(100 * s.users) / max}%` }} /></div></div>))}</div>
        <p className="mt-2 text-xs text-muted">{fn.data?.note}</p>
      </Section>
      <Section title="Когорты (удержание по оплатам)">
        {!co.data?.cohorts.length ? <Empty title="Данных пока нет" /> : (
          <div className="overflow-x-auto"><table className="text-sm"><thead><tr className="text-xs text-muted"><th className="p-2 text-left">Когорта</th><th className="p-2">n</th>{co.data.cohorts[0]!.retention.map((_, k) => <th key={k} className="p-2">М{k}</th>)}</tr></thead>
            <tbody>{co.data.cohorts.map((c) => <tr key={c.cohort} className="border-t border-fg/10"><td className="p-2">{c.cohort}</td><td className="p-2 text-center">{c.size}</td>{c.retention.map((v, k) => <td key={k} className="p-2 text-center">{v == null ? '·' : `${v}%`}</td>)}</tr>)}</tbody></table></div>
        )}
        <p className="mt-2 text-xs text-muted">{co.data?.method}</p>
      </Section>
    </div>
  );
}

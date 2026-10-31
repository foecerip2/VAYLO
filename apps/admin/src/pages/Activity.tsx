import { Badge, Card, ErrorState, KpiTile, Skeleton } from '@vpn/ui';
import type { ActivityDTO } from '@vpn/shared';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Disc3, Eye, UserPlus, Users, Wifi } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageTitle, Section } from '../components/kit';
import { get } from '../lib/api';
import { rub } from '../lib/format';

const tick = { fontSize: 11, fill: 'currentColor' };
const shortDay = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7);
const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 12, color: 'rgb(var(--text))', fontSize: 13 };
export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};
const EV: Record<string, { icon: React.ReactNode; tone: string }> = {
  signup: { icon: <UserPlus className="h-4 w-4" />, tone: 'bg-primary/15 text-primary' },
  payment: { icon: <CreditCard className="h-4 w-4" />, tone: 'bg-success/15 text-success' },
  wheel: { icon: <Disc3 className="h-4 w-4" />, tone: 'bg-danger/15 text-danger' },
  quest: { icon: <Eye className="h-4 w-4" />, tone: 'bg-warning/15 text-warning' },
};
const SUB: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Подписка', tone: 'success' }, trial: { label: 'Пробный', tone: 'warning' }, expired: { label: 'Истекла', tone: 'danger' }, none: { label: 'Нет', tone: 'neutral' },
};

export default function ActivityPage() {
  const q = useQuery({ queryKey: ['activity'], queryFn: () => get<ActivityDTO>('/activity'), refetchInterval: 30_000 });
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const d = q.data;
  const s = d?.summary;
  return (
    <div className="animate-fade-up">
      <PageTitle title="Активность" subtitle="Кто и что делает в сервисе сейчас. Обновляется каждые 30 секунд." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!s ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 !rounded-card" />) : (
          <>
            <KpiTile label="В VPN сейчас" value={s.vpnOnline ?? '—'} sub={s.vpnOnline === null ? 'нет данных от панели' : 'по данным нод'} icon={<Wifi className="h-5 w-5" />} tone="success" />
            <KpiTile label="Заходили за час" value={s.online1h} sub="в бот или мини-апп" icon={<Eye className="h-5 w-5" />} tone="primary" />
            <KpiTile label="Активны за сутки" value={s.active1d} sub={`${s.total ? Math.round((s.active1d / s.total) * 100) : 0}% базы`} icon={<Users className="h-5 w-5" />} />
            <KpiTile label="Активны за неделю" value={s.active7d} sub={`за месяц: ${s.active30d}`} icon={<Users className="h-5 w-5" />} />
            <KpiTile label="Новые за сутки" value={s.new1d} sub={`всего ${s.total}`} icon={<UserPlus className="h-5 w-5" />} tone="primary" />
            <KpiTile label="Платили за 30 дней" value={s.paying30d} sub="уникальных пользователей" icon={<CreditCard className="h-5 w-5" />} tone="success" />
            <KpiTile label="Активных подписок" value={s.activeSubs} icon={<Users className="h-5 w-5" />} tone="success" />
            <KpiTile label="Участвуют в бонусах" value={d.series.reduce((a, x) => a + x.engagement, 0)} sub="колесо и задания, 14 дней" icon={<Disc3 className="h-5 w-5" />} tone="warning" />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Динамика за 14 дней" description="Визиты — сколько пользователей в этот день заходили последний раз; на старых днях значение занижено.">
          <div className="h-64 text-muted">
            {d ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.series} margin={{ left: -24, right: 4, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} vertical={false} />
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} axisLine={false} tickLine={false} interval={1} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDay} cursor={{ fill: 'currentColor', fillOpacity: 0.08 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="signups" name="Регистрации" fill="#32d583" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="payments" name="Оплаты" fill="#7c7cff" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="engagement" name="Бонусы" fill="#f79009" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-full w-full" />}
          </div>
        </Section>

        <Section title="Последние события">
          {!d ? <Skeleton className="h-64" /> : d.events.length === 0 ? <p className="text-sm text-muted">Пока ничего не происходило.</p> : (
            <div className="max-h-64 divide-y divide-border overflow-y-auto pr-1">
              {d.events.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${EV[e.type]?.tone}`}>{EV[e.type]?.icon}</span>
                  <span className="min-w-0 flex-1"><b className="break-words">{e.name}</b> <span className="text-muted">{e.detail}</span>{e.amount ? <b className="ml-1">{rub(e.amount)}</b> : null}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Недавно заходили">
        {!d ? <Skeleton className="h-40" /> : (
          <div className="divide-y divide-border">
            {d.recent.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1"><b className="break-words">{u.name}</b>{u.banned && <Badge tone="danger" className="ml-2">бан</Badge>}{u.tgId ? <span className="ml-2 text-xs text-muted">{u.tgId}</span> : null}</span>
                <Badge tone={SUB[u.subState]?.tone ?? 'neutral'}>{SUB[u.subState]?.label ?? u.subState}</Badge>
                <span className="w-24 shrink-0 text-right text-xs text-muted">{ago(u.lastSeenAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

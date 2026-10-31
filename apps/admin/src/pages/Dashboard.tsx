import { ErrorState, StatusPill, cn } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Clock, CreditCard, Globe2, Percent, UserPlus, UserX, WalletCards } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { Empty, Sk, SkBars, SkDonut, SkRows } from '../components/kit';
import { CountUp } from '../fx/CountUp';
import { PROVIDER_LABEL, rub } from '../lib/format';
import { get } from '../lib/api';

interface Overview {
  users: { total: number; new_1d: number; new_7d: number; new_30d: number; blocked: number };
  subscriptions: { active: number; trial: number; expiring: number; expired: number };
  revenue: { today: number; d7: number; d30: number; total: number; count30: number };
  pendingPayments: number;
  unfulfilledPayments: number;
  trialConversion: number;
  revenueSeries: { day: string; amount: number }[];
  signupsSeries: { day: string; count: number }[];
  byProvider: { provider: string; amount: number; count: number }[];
  topPlans: { name: string; count: number; amount: number }[];
}
interface NodeRow { id: string; name: string; countryCode: string | null; online: boolean; disabled: boolean; usersOnline: number }

/** Одна палитра на все графики; цвета читаются и на тёмном, и на светлом фоне */
const C = { violet: '#8b5cf6', pink: '#a89cdb', mint: '#34d3ae', amber: '#ffb26d', grape: '#7c3aed', rose: '#f43f5e', slate: '#94a3b8' };
const shortDay = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7);
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const flag = (cc: string | null) => (cc && /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌐');
const rubShort = (kop: number) => { const r = kop / 100; return r >= 1e6 ? (r / 1e6).toFixed(1).replace('.0', '') + ' млн ₽' : r >= 1e4 ? Math.round(r / 1000) + ' тыс ₽' : Math.round(r).toLocaleString('ru-RU') + ' ₽'; };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** изменение последних 7 дней к предыдущим 7, % */
function delta(v: number[]): number | null {
  const cur = sum(v.slice(-7)), prev = sum(v.slice(-14, -7));
  if (!prev) return cur ? 100 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

function Glass({ className, children, title, right, tilt = true }: { className?: string; children: ReactNode; title?: string; right?: ReactNode; tilt?: boolean }) {
  return (
    <section className={cn('card relative p-5 md:p-6', tilt && 'tilt', className)}>
      {title && <div className="mb-4 flex items-start justify-between gap-3"><h2 className="text-[15px] font-bold">{title}</h2>{right}</div>}
      {children}
    </section>
  );
}

function Tip({ active, payload, label, fmt }: { active?: boolean; payload?: { name: string; value: number; color?: string; stroke?: string; fill?: string; dataKey?: string }[]; label?: string; fmt: (k: string, v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="vg-tip">
      {label && <div className="mb-1 text-[11px] text-muted">{/^\d{4}-/.test(label) ? shortDay(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: p.stroke ?? p.color ?? p.fill, boxShadow: `0 0 8px ${p.stroke ?? p.color ?? p.fill}` }} /><b>{fmt(p.dataKey ?? p.name, p.value)}</b></div>
      ))}
    </div>
  );
}

function Spark({ data, color, id }: { data: number[]; color: string; id: string }) {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.45} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive animationDuration={1400} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Kpi({ label, value, fmt, d, color, spark, sub, i }: { label: string; value: number; fmt?: (n: number) => string; d: number | null; color: string; spark: number[]; sub?: string; i: number }) {
  return (
    <Glass className="overflow-hidden !p-5">
      <div className="z relative z-10">
        <div className="text-[13px] text-muted">{label}</div>
        <div className="mt-2 text-[28px] font-extrabold leading-none tracking-tight md:text-[30px]"><CountUp value={value} format={fmt} /></div>
        <div className="mt-2 flex w-fit items-center gap-1.5 rounded-full bg-surface/70 py-0.5 pr-2 text-[12.5px] font-bold" style={{ color }}>
          {d !== null && (d >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />)}
          {d !== null ? `${d > 0 ? '+' : ''}${d}% за неделю` : sub}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-0 right-0 h-[52px] w-[48%] opacity-80"><Spark data={spark} color={color} id={`sp${i}`} /></div>
    </Glass>
  );
}

function KpiSkeleton() {
  return (
    <section className="card relative h-[132px] overflow-hidden p-5" aria-busy="true" aria-label="Загрузка">
      <Sk className="h-3 w-28" /><Sk className="mt-4 h-7 w-36" /><Sk className="mt-3 h-4 w-24 !rounded-full" />
      <Sk className="absolute bottom-0 right-0 h-[46px] w-[44%] !rounded-none !rounded-tl-2xl" />
    </section>
  );
}

function Seg({ pct, color }: { pct: number; color: string }) {
  return <div className="vg-seg"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color, boxShadow: `0 0 10px ${color}` }} /></div>;
}

const RANGES = [{ k: 7, l: '7Д' }, { k: 14, l: '14Д' }, { k: 30, l: '30Д' }] as const;

function HealthStrip() {
  const inc = useQuery({ queryKey: ['dash-inc'], queryFn: () => get<{ enabled: boolean; items: { id: string; state: string; target: string; operator: string }[] }>('/network-intelligence/incidents'), refetchInterval: 60_000 });
  const w = useQuery({ queryKey: ['dash-worker'], queryFn: () => get<{ alive: boolean; ageSec: number | null }>('/system/worker-health'), refetchInterval: 30_000 });
  const confirmed = inc.data?.items.filter((i) => i.state === 'confirmed') ?? [];
  const suspected = inc.data?.items.filter((i) => i.state === 'suspected') ?? [];
  return (
    <div className="flex flex-wrap gap-2" aria-label="Здоровье сервиса">
      <Link to="/network-intelligence"><StatusPill tone={!inc.data?.enabled ? 'unknown' : confirmed.length ? 'bad' : suspected.length ? 'warn' : 'ok'}>
        {!inc.data?.enabled ? 'Сеть: аналитика выключена' : confirmed.length ? `Сеть: подтверждено сбоев ${confirmed.length}` : suspected.length ? `Сеть: под подозрением ${suspected.length}` : 'Сеть: инцидентов нет'}</StatusPill></Link>
      <StatusPill tone={w.data ? (w.data.alive ? 'ok' : 'bad') : 'unknown'}>{w.data ? (w.data.alive ? 'Воркер работает' : 'Воркер не отвечает') : 'Воркер: нет данных'}</StatusPill>
    </div>
  );
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/stats/overview'), refetchInterval: 60_000 });
  const mon = useQuery({ queryKey: ['monitoring'], queryFn: () => get<{ state: { label: string; status: string }[] }>('/monitoring'), refetchInterval: 60_000 });
  const purp = useQuery({ queryKey: ['purposes'], queryFn: () => get<{ purpose: string; amount: number; count: number }[]>('/stats/purposes') });
  const nodes = useQuery({ queryKey: ['nodes'], queryFn: () => get<{ configured: boolean; error?: string; items: NodeRow[] }>('/nodes'), refetchInterval: 30_000 });
  const [range, setRange] = useState<number>(30);
  const d = q.data;

  const series = useMemo(() => {
    if (!d) return [];
    return d.revenueSeries.map((r, i) => ({ day: r.day, revenue: r.amount / 100, signups: d.signupsSeries[i]?.count ?? 0 })).slice(-range);
  }, [d, range]);
  const week = useMemo(() => (d ? d.signupsSeries.slice(-7).map((s) => ({ day: WD[new Date(s.day).getDay()]!, count: s.count })) : []), [d]);
  const weekMax = Math.max(0, ...week.map((w) => w.count));
  const noChartData = series.length > 0 && series.every((r) => !r.revenue && !r.signups);

  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const down = mon.data?.state.filter((x) => x.status === 'down') ?? [];
  const rev = d?.revenueSeries.map((x) => x.amount) ?? [];
  const sig = d?.signupsSeries.map((x) => x.count) ?? [];
  const subsTotal = d ? d.subscriptions.active + d.subscriptions.trial + d.subscriptions.expired : 0;
  const donut = d ? [
    { name: 'Активные', value: Math.max(0, d.subscriptions.active - d.subscriptions.expiring), color: C.violet },
    { name: 'Истекают за 3 дня', value: d.subscriptions.expiring, color: C.amber },
    { name: 'Пробные', value: d.subscriptions.trial, color: C.pink },
    { name: 'Истекли', value: d.subscriptions.expired, color: C.slate },
  ] : [];
  const maxProv = Math.max(1, ...(d?.byProvider.map((p) => p.amount) ?? [1]));
  const nodeItems = nodes.data?.items ?? [];
  const maxOnline = Math.max(1, ...nodeItems.map((n) => n.usersOnline));
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-fg via-fg to-primary-2 bg-clip-text text-[26px] text-transparent md:text-[34px]">{hello}</h1>
          <p className="mt-1 text-sm text-muted">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })} · {down.length ? <span className="text-danger">есть проблемы в системе</span> : 'всё работает штатно'}</p>
        </div>
        {d && (
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="chip !bg-fg/[.04] !py-1.5"><Percent className="h-3.5 w-3.5" />Конверсия триала <b className="text-fg">{d.trialConversion}%</b></span>
            <span className="chip !bg-fg/[.04] !py-1.5"><Clock className="h-3.5 w-3.5" />Ждут оплаты <b className="text-fg">{d.pendingPayments}</b></span>
            <span className="chip !bg-fg/[.04] !py-1.5"><UserX className="h-3.5 w-3.5" />Заблокировали бота <b className="text-fg">{d.users.blocked}</b></span>
          </div>
        )}
      </div>

      <div className="mb-4"><HealthStrip /></div>

      {down.length > 0 && (
        <Link to="/monitoring" className="mb-4 flex items-center gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm backdrop-blur">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" /><span><b>Проблемы в системе:</b> {down.map((x) => x.label).join(', ')}. Подробности — в «Мониторинг».</span>
        </Link>
      )}
      {d && d.unfulfilledPayments > 0 && (
        <Link to="/payments?status=succeeded" className="mb-4 flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm backdrop-blur">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" /><span><b>{d.unfulfilledPayments}</b> оплаченных платежей ещё не выполнены. Воркер повторяет попытки — проверьте подключение к Remnawave в «Настройки».</span>
        </Link>
      )}

      <div className="vg-stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!d ? [0, 1, 2, 3].map((i) => <KpiSkeleton key={i} />) : (
          <>
            <Kpi i={0} label="Выручка за 30 дней" value={d.revenue.d30} fmt={(n) => rub(Math.round(n))} d={delta(rev)} color={C.violet} spark={rev} />
            <Kpi i={1} label="Активные подписки" value={d.subscriptions.active} d={null} sub={`пробных: ${d.subscriptions.trial}`} color={C.pink} spark={sig.map((_, i) => sum(sig.slice(0, i + 1)))} />
            <Kpi i={2} label="Новые за 7 дней" value={d.users.new_7d} d={delta(sig)} color={C.mint} spark={sig} />
            <Kpi i={3} label="Выручка сегодня" value={d.revenue.today} fmt={(n) => rub(Math.round(n))} d={null} sub={`за 7 дней: ${rub(d.revenue.d7)}`} color={C.amber} spark={rev.slice(-14)} />
          </>
        )}
      </div>

      <div className="vg-stagger mt-4 grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <Glass title="Выручка и регистрации" tilt={false} right={
          <div className="flex rounded-full border border-fg/10 p-[3px]">
            {RANGES.map((r) => <button key={r.k} onClick={() => setRange(r.k)} className={cn('rounded-full px-3 py-1 text-xs font-bold transition', range === r.k ? 'bg-primary/20 text-fg shadow-[inset_0_0_0_1px_rgb(var(--primary)/.55)]' : 'text-muted hover:text-fg')}>{r.l}</button>)}
          </div>
        }>
          <div className="-mt-2 mb-3 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: C.violet, boxShadow: `0 0 8px ${C.violet}` }} />Выручка, ₽</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: C.pink, boxShadow: `0 0 8px ${C.pink}` }} />Регистрации</span>
          </div>
          <div className="vg-chart h-[280px] text-muted">
            {!d ? <SkBars n={16} /> : noChartData ? (
              <Empty icon={<BarChart3 className="h-5 w-5" />} title="Пока нет данных за период" text="Когда появятся первые оплаты и регистрации, здесь построится график. Начните с тарифов." to="/plans" action="Создать тариф" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ left: -8, right: 4, top: 8 }}>
                  <defs>
                    <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.violet} stopOpacity={0.5} /><stop offset="1" stopColor={C.violet} stopOpacity={0} /></linearGradient>
                    <linearGradient id="gSig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.pink} stopOpacity={0.35} /><stop offset="1" stopColor={C.pink} stopOpacity={0} /></linearGradient>
                  </defs>
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'currentColor' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis yAxisId="r" tickFormatter={(v) => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',') + 'к' : String(v))} allowDecimals={false} tick={{ fontSize: 11, fill: 'currentColor' }} axisLine={false} tickLine={false} width={40} />
                  <YAxis yAxisId="s" orientation="right" hide allowDecimals={false} />
                  <Tooltip content={<Tip fmt={(k, v) => (k === 'revenue' ? `${Math.round(v).toLocaleString('ru-RU')} ₽` : `${v} регистраций`)} />} cursor={{ stroke: 'rgba(255,255,255,.25)', strokeDasharray: '3 4' }} />
                  <Area yAxisId="s" type="monotone" dataKey="signups" stroke={C.pink} strokeWidth={2.2} fill="url(#gSig)" activeDot={{ r: 5, stroke: C.pink, strokeWidth: 2, fill: 'rgb(var(--bg))' }} animationDuration={1500} />
                  <Area yAxisId="r" type="monotone" dataKey="revenue" stroke={C.violet} strokeWidth={2.6} fill="url(#gRev)" activeDot={{ r: 6, stroke: C.violet, strokeWidth: 2.5, fill: 'rgb(var(--bg))' }} animationDuration={1500} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Glass>

        <Glass title="Подписки">
          {!d ? <SkDonut /> : (
            <div className="z">
              <div className="flex flex-wrap items-center gap-5">
                <div className="relative h-[170px] w-[170px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut.some((x) => x.value) ? donut : [{ name: 'нет', value: 1, color: 'rgb(var(--text) / .1)' }]} dataKey="value" innerRadius={58} outerRadius={78} paddingAngle={donut.filter((x) => x.value).length > 1 ? 4 : 0} cornerRadius={8} stroke="none" startAngle={90} endAngle={-270} animationDuration={1300}>
                        {(donut.some((x) => x.value) ? donut : [{ color: 'rgb(var(--text) / .1)' }]).map((x, i) => <Cell key={i} fill={x.color} style={{ filter: `drop-shadow(0 0 6px ${x.color})` }} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-[28px] font-extrabold leading-none"><CountUp value={subsTotal} /></div><div className="mt-1 text-[11px] text-muted">всего</div></div></div>
                </div>
                <div className="min-w-[150px] flex-1 space-y-2.5">
                  {donut.map((x) => (
                    <div key={x.name} className="flex items-center gap-2.5 text-[13px]"><i className="h-2.5 w-2.5 rounded-full" style={{ background: x.color, boxShadow: `0 0 8px ${x.color}` }} /><span className="text-muted">{x.name}</span><b className="ml-auto tabular">{x.value}</b></div>
                  ))}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-fg/[.07] pt-4">
                <div><div className="text-[11.5px] text-muted">Средний чек</div><div className="mt-1 text-lg font-extrabold">{d.revenue.count30 ? rubShort(d.revenue.d30 / d.revenue.count30) : '—'}</div></div>
                <div><div className="text-[11.5px] text-muted">Платежей</div><div className="mt-1 text-lg font-extrabold"><CountUp value={d.revenue.count30} /></div></div>
                <div><div className="text-[11.5px] text-muted">Конверсия</div><div className="mt-1 text-lg font-extrabold">{d.trialConversion}%</div></div>
              </div>
            </div>
          )}
        </Glass>
      </div>

      <div className="vg-stagger mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Glass title="Регистрации за неделю" right={d && <span className="chip !bg-fg/[.04]">+{d.users.new_1d} сегодня</span>}>
          <div className="z h-[200px] text-muted">
            {!d ? <SkBars /> : weekMax === 0 ? (
              <Empty icon={<UserPlus className="h-5 w-5" />} title="За неделю нет регистраций" text="Пригласите первых пользователей: настройте рефералы или сделайте рассылку." to="/referrals" action="Открыть рефералов" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={week} margin={{ left: -28, right: 0, top: 22 }}>
                  <defs>
                    <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(168,85,247,.16)" /><rect width="3" height="7" fill="rgba(168,85,247,.38)" /></pattern>
                    <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d946ef" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'currentColor' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'currentColor' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<Tip fmt={(_, v) => `${v} новых`} />} cursor={{ fill: 'rgba(255,255,255,.04)', radius: 10 } as never} />
                  <Bar dataKey="count" radius={[10, 10, 10, 10]} animationDuration={1100} label={{ position: 'top', fontSize: 11, fontWeight: 800, fill: 'rgb(var(--text))', formatter: (v: number) => (v === weekMax && v > 0 ? v : '') }}>
                    {week.map((w, i) => <Cell key={i} fill={w.count === weekMax && weekMax > 0 ? 'url(#gBar)' : 'url(#hatch)'} stroke={w.count === weekMax && weekMax > 0 ? 'none' : 'rgba(168,85,247,.35)'} style={w.count === weekMax && weekMax > 0 ? { filter: 'drop-shadow(0 0 12px rgba(217,70,239,.6))' } : undefined} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Glass>

        <Glass title="Ноды" right={nodes.data?.configured && <span className={cn('chip', nodeItems.every((n) => n.online || n.disabled) ? '!bg-success/10 !text-success' : '!bg-danger/10 !text-danger')}>{nodeItems.filter((n) => n.online).length} из {nodeItems.length} онлайн</span>}>
          <div className="z space-y-3.5">
            {nodes.isLoading ? <SkRows n={4} /> : !nodes.data?.configured ? <Empty icon={<Globe2 className="h-5 w-5" />} title="Remnawave не подключена" text="Подключите панель, чтобы видеть ноды и выдавать подписки." to="/settings" action="Подключить в настройках" /> : nodeItems.length === 0 ? <Empty icon={<Globe2 className="h-5 w-5" />} title="Нод пока нет" text="Добавьте первый VPN-сервер — установщик подключит его к панели одной командой." to="/nodes" action="Открыть ноды" /> : nodeItems.slice(0, 6).map((n) => (
              <Link key={n.id} to="/nodes" className="flex items-center gap-3 text-[13.5px]">
                <span className="w-[132px] truncate">{flag(n.countryCode)} {n.name}</span>
                <i className="vg-live" style={{ background: n.disabled ? '#6b6480' : n.online ? C.mint : C.rose, boxShadow: `0 0 9px ${n.disabled ? 'transparent' : n.online ? C.mint : C.rose}` }} />
                <Seg pct={(n.usersOnline / maxOnline) * 100} color={n.online ? C.violet : C.rose} />
                <b className="w-9 text-right tabular" title="Пользователей онлайн">{n.usersOnline}</b>
              </Link>
            ))}
          </div>
        </Glass>

        <Glass title="Платёжные системы · 30 дней" className="lg:col-span-2 xl:col-span-1">
          <div className="z space-y-4">
            {!d ? <SkRows n={3} /> : d.byProvider.length === 0 ? <Empty icon={<CreditCard className="h-5 w-5" />} title="Пока нет оплат" text="Подключите платёжную систему, и здесь появится разбивка по способам оплаты." to="/settings" action="Настроить оплату" /> : d.byProvider.map((p, i) => (
              <div key={p.provider}>
                <div className="mb-1.5 flex justify-between text-[13px]"><span className="font-semibold">{PROVIDER_LABEL[p.provider] ?? p.provider}</span><span className="text-muted">{rub(p.amount)} · {p.count} шт.</span></div>
                <Seg pct={(p.amount / maxProv) * 100} color={[C.violet, C.pink, C.mint, C.amber][i % 4]!} />
              </div>
            ))}
          </div>
        </Glass>
      </div>

      <div className="vg-stagger mt-4 grid gap-4 md:grid-cols-2">
        <Glass title="Популярные тарифы · 30 дней">
          <div className="z">
            {!d ? <SkRows n={3} /> : d.topPlans.length === 0 ? <Empty icon={<WalletCards className="h-5 w-5" />} title="Пока нет покупок" text="Тарифы появятся здесь после первых оплат. Проверьте, что тарифы созданы и включены." to="/plans" action="Открыть тарифы" /> : d.topPlans.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3 border-b border-fg/[.06] py-3 text-[13.5px] last:border-0">
                <span className="grid h-8 w-8 place-items-center rounded-xl text-xs font-extrabold" style={{ background: `${[C.violet, C.pink, C.mint, C.amber][i % 4]}22`, color: [C.violet, C.pink, C.mint, C.amber][i % 4] }}>{i + 1}</span>
                <span className="font-semibold">{p.name}</span><span className="ml-auto text-muted">{p.count} шт. · <b className="text-fg">{rub(p.amount)}</b></span>
              </div>
            ))}
          </div>
        </Glass>
        <Glass title="Выручка по назначению · 30 дней">
          <div className="z">
            {!purp.data ? <SkRows n={3} /> : purp.data.length === 0 ? <Empty icon={<CreditCard className="h-5 w-5" />} title="Пока нет оплат" text="Здесь будет видно, на что тратят: тарифы, докупки или пополнения." to="/payments" action="Открыть платежи" /> : purp.data.map((p, i) => (
              <div key={p.purpose} className="flex items-center gap-3 border-b border-fg/[.06] py-3 text-[13.5px] last:border-0">
                <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: `${[C.pink, C.violet, C.mint][i % 3]}22`, color: [C.pink, C.violet, C.mint][i % 3] }}><CreditCard className="h-4 w-4" /></span>
                <span className="font-semibold">{p.purpose === 'plan' ? 'Тарифы' : p.purpose === 'addon' ? 'Докупки' : 'Пополнения баланса'}</span><span className="ml-auto text-muted">{p.count} шт. · <b className="text-fg">{rub(p.amount)}</b></span>
              </div>
            ))}
          </div>
        </Glass>
      </div>
    </div>
  );
}

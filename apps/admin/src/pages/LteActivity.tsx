import type { LteActivityDTO, LteActivityHistoryDTO, LteActivityUserDTO } from '@vpn/shared';
import { bytesToHuman } from '@vpn/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Input, KpiTile, Select, Sheet, Skeleton, Tabs } from '@vpn/ui';
import { Activity, ArrowUpRight, Clock3, History, RefreshCw, Search, Users, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, PageTitle, Pagination, type Column } from '../components/kit';
import { get } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';

const dateOnly = (day: string | null) => day ? fmtDate(day + 'T12:00:00') : '—';
const unavailable = {
  disabled: 'Учёт LTE не подключён. Подключите существующую интеграцию Remnawave в настройках сервера.',
  unavailable: 'Данные LTE временно недоступны. Проверьте SSH-туннель и связь с Remnawave.',
};
function Person({ u }: { u: LteActivityUserDTO }) {
  return <div><div className="font-semibold">{u.name ?? u.rwUsername}{u.username && <span className="ml-1 font-normal text-muted">@{u.username}</span>}</div>
    <div className="mt-1 text-xs text-muted">{u.tgId ? `TG ${u.tgId} · ` : ''}{u.rwUsername} · ID {u.rwId}</div></div>;
}
function ActivityBadge({ active }: { active: boolean | null }) {
  return <Badge tone={active ? 'success' : 'neutral'}>{active === null ? 'Время неизвестно' : active ? 'Трафик ≤ 5 мин' : 'Ранее'}</Badge>;
}

export default function LteActivity() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'active' | 'history'>(params.get('q') ? 'history' : 'active');
  const [days, setDays] = useState(7), [page, setPage] = useState(1);
  const [search, setSearch] = useState(params.get('q') ?? ''), [debounced, setDebounced] = useState(search);
  const [selected, setSelected] = useState<LteActivityUserDTO | null>(null);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const q = useQuery({ queryKey: ['lte-activity', mode, days, debounced, page], retry: false,
    queryFn: () => get<LteActivityDTO>(`/lte-activity?mode=${mode}&days=${days}&q=${encodeURIComponent(debounced)}&page=${page}`),
    refetchInterval: 30_000, refetchIntervalInBackground: false });
  const d = q.data, ready = d?.state === 'ready';
  const cols: Column<LteActivityUserDTO>[] = [
    { key: 'user', header: 'Пользователь', primary: true, render: u => <Person u={u} /> },
    { key: 'active', header: 'Активность LTE', render: u => <div className="space-y-1"><ActivityBadge active={u.active} /><div className="text-xs text-muted">{u.inSquad ? 'Есть доступ к группе LTE' : 'Нет в группе LTE'}</div></div> },
    { key: 'when', header: 'Последний трафик', render: u => <div>{u.lastSeenAt ? fmtDateTime(u.lastSeenAt) : dateOnly(u.lastUsageDay)}{!u.lastSeenAt && <div className="text-xs text-muted">Известен только день</div>}</div> },
    { key: 'usage', header: 'За период', render: u => <div className="tabular font-semibold">{bytesToHuman(u.periodBytes)}<div className="mt-1 text-xs font-normal text-muted">Дней с трафиком: {u.daysUsed}</div></div> },
    { key: 'remaining', header: 'Остаток LTE', render: u => <div>{bytesToHuman(u.remainingBytes)}<div className="mt-1 text-xs text-muted">из {bytesToHuman(u.limitBytes)} · окно 30 дней</div></div> },
    { key: 'history', header: '', render: u => <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); setSelected(u); }} icon={<History className="h-4 w-4" />}>История</Button> },
  ];
  return <div className="animate-fade-up space-y-5">
    <PageTitle title="Активность LTE" subtitle="Кто пользуется локациями LTE и когда проходил трафик."
      actions={<Button variant="secondary" loading={q.isFetching} onClick={() => void q.refetch()} icon={<RefreshCw className="h-4 w-4" />}>Обновить</Button>} />
    <div className="grid gap-3 sm:grid-cols-3">
      <KpiTile label="Активны за 5 минут" value={ready && d.stats?.activeUsers != null ? d.stats.activeUsers : '—'} tone="success" icon={<Wifi className="h-5 w-5" />} sub="Недавний трафик через LTE" />
      <KpiTile label="Пользовались за период" value={ready ? d.stats?.periodUsers ?? '—' : '—'} icon={<Users className="h-5 w-5" />} sub={ready ? `${dateOnly(d.from)} — ${dateOnly(d.to)}` : 'История из Remnawave'} />
      <KpiTile label="Трафик LTE за период" value={ready && d.stats ? bytesToHuman(d.stats.periodBytes) : '—'} icon={<Activity className="h-5 w-5" />} sub={debounced ? 'С учётом поиска' : 'Отдельно от безлимитного VPN'} />
    </div>
    <Card className="flex items-start gap-3 border-primary/25 p-4 text-sm"><span className="mt-0.5 rounded-xl bg-primary/15 p-2 text-primary"><Clock3 className="h-5 w-5" /></span><div><p className="font-semibold">Активность по трафику</p><p className="mt-1 text-muted">«Трафик ≤ 5 мин» означает, что Remnawave недавно записала расход на LTE-ноде. Данные обновляются каждые 30 секунд с задержкой учёта панели. Наличие пользователя в группе LTE само по себе не означает подключение.</p></div></Card>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs value={mode} onChange={v => { setMode(v); setPage(1); }} items={[{ value: 'active', label: 'Активны сейчас' }, { value: 'history', label: 'История использования' }]} />
      <div className="flex w-full flex-wrap gap-2 md:w-auto"><Select className="!w-auto" aria-label="Период LTE" value={String(days)} onChange={e => { setDays(Number(e.target.value)); setPage(1); }}><option value="1">Сегодня</option><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option></Select>
        <div className="relative min-w-64 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input className="pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя, @username, TG ID или ID" aria-label="Поиск LTE" /></div></div>
    </div>
    {q.isError ? <ErrorState message="Не удалось загрузить активность LTE." onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-64" /> : !ready ?
      <Card className="p-5 text-sm text-muted">{unavailable[d.state as keyof typeof unavailable]}</Card> : <>
        {d.precision === 'day' && <Card className="border-warning/30 p-4 text-sm">Эта версия Remnawave отдаёт только дневной расход. Точное время активности недоступно — смотрите историю по дням.</Card>}
        <DataTable columns={cols} rows={d.items} onRowClick={setSelected} rowKey={u => u.rwId} empty={mode === 'active' ? 'За последние 5 минут трафика LTE не зафиксировано' : 'За выбранный период трафика LTE не найдено'} />
        <Pagination page={d.page} limit={d.limit} total={d.total} onChange={setPage} />
        <p className="text-xs text-muted">Нода LTE: #{d.nodeId} · проверено {fmtDateTime(d.checkedAt)} · время: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Учёт дней — UTC. {debounced && 'Все показатели учитывают поиск.'}</p>
      </>}
    <HistorySheet user={selected} days={days} onClose={() => setSelected(null)} />
  </div>;
}

function HistorySheet({ user, days, onClose }: { user: LteActivityUserDTO | null; days: number; onClose: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [user?.rwId, days]);
  const q = useQuery({ queryKey: ['lte-activity-history', user?.rwId, days, page], enabled: !!user, retry: false,
    queryFn: () => get<LteActivityHistoryDTO>(`/lte-activity/${user!.rwId}?days=${days}&page=${page}`), refetchInterval: 30_000, refetchIntervalInBackground: false });
  const d = q.data, maxBytes = Math.max(1, ...(d?.items.map(v => v.bytes) ?? []));
  const current = d?.state === 'ready' && d.user ? d.user : user;
  return <Sheet open={!!user} onClose={onClose} title="История LTE"><div className="space-y-4">
    {current && <Card className="space-y-3 p-4"><Person u={current} /><ActivityBadge active={q.isError || d?.state !== 'ready' ? null : current.active} />
      {current.localUserId && <Link className="flex items-center gap-1 text-sm font-semibold text-primary" to={`/users?userId=${current.localUserId}`}>Открыть пользователя <ArrowUpRight className="h-4 w-4" /></Link>}
    </Card>}
    <p className="text-sm text-muted">Расход по дням и время последней записи трафика в каждом дне. Remnawave хранит дневные суммы; время начала и завершения отдельных соединений из них определить нельзя.</p>
    {q.isError ? <ErrorState message="Не удалось загрузить историю LTE." onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-40" /> : d.state !== 'ready' ? <Card className="p-4 text-sm text-muted">{unavailable[d.state]}</Card> : <>
      <p className="text-xs text-muted">{dateOnly(d.from)} — {dateOnly(d.to)} · дни UTC, время в вашем часовом поясе</p>
      <Card className="divide-y divide-border">{d.items.length ? d.items.map(v => <div className="space-y-2 p-4" key={v.day}><div className="flex items-center justify-between gap-3 text-sm"><b>{dateOnly(v.day)}</b><b className="tabular">{bytesToHuman(v.bytes)}</b></div><div className="h-1.5 overflow-hidden rounded-full bg-primary/10"><div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-2" style={{ width: `${v.bytes / maxBytes * 100}%` }} /></div><p className="text-xs text-muted">{v.lastSeenAt ? `Последняя запись: ${fmtDateTime(v.lastSeenAt)}` : 'Точное время недоступно'}</p></div>) : <p className="p-4 text-sm text-muted">В этом периоде записей нет.</p>}</Card>
      <Pagination page={d.page} limit={d.limit} total={d.total} onChange={setPage} />
    </>}
  </div></Sheet>;
}

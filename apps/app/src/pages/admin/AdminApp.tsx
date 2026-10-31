import { SupportDesk, type SupportTransport } from '@vpn/support';
import { Badge, Button, Card, EmptyState, ErrorState, Input, KpiTile, Sheet, Skeleton, Spinner, Switch, cn, useToast } from '@vpn/ui';
import type { ActivityDTO, AttentionDTO } from '@vpn/shared';
import { bytesToHuman, deviceLimitLabel, formatRub, paymentPurposeLabel, paymentStatusLabel, ROLE_LEVEL } from '@vpn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Headset, Activity, ChevronRight, CreditCard, Banknote, Disc3, Eye, Network, UserPlus, Wifi, Search, ShieldAlert, TrendingUp, Users, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { errorText } from '../../lib/api';
import { aget, apost, aput, apatch, adel, aLoadSupportPhoto, setTotpPrompt } from '../../lib/adminApi';
import { useMe } from '../../lib/queries';
import { haptic } from '../../lib/tg';

const err = (e: unknown) => errorText(e, 'Ошибка');

const supportApi:SupportTransport={get:aget,post:apost,put:aput,patch:apatch,del:adel,loadSupportPhoto:aLoadSupportPhoto};
function AdminSupport(){const me=useMe();return me.data?.adminRole?<SupportDesk api={supportApi} role={me.data.adminRole} embedded/>:null;}

export default function AdminApp() {
  const me = useMe();
  if (me.isLoading) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>;
  if (!me.data?.adminRole) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Нет доступа" text="Этот Telegram-аккаунт не привязан к администратору. Укажите Telegram ID в разделе «Админы» веб-админки." /></Card>;
  return (
    <TotpGate>
      <div className="mini-admin min-w-0">
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="referrals" element={<ReferralsFeed />} />
        <Route path="withdrawals" element={<WithdrawalsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="support" element={<AdminSupport/>} />
      </Routes>
      </div>
    </TotpGate>
  );
}

/** Если у админа включена 2FA и свежей подписи Telegram нет, сервер просит код — показываем окно ввода */
function TotpGate({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<{ retry: boolean } | null>(null);
  const [code, setCode] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);
  useEffect(() => {
    setTotpPrompt((retry) => new Promise<string | null>((resolve) => {
      resolver.current?.(null);
      resolver.current = resolve;
      setCode('');
      setAsk({ retry });
    }));
    return () => {
      setTotpPrompt(null);
      resolver.current?.(null);
    };
  }, []);
  const finish = (v: string | null) => {
    const r = resolver.current;
    resolver.current = null;
    setAsk(null);
    r?.(v);
  };
  return (
    <>
      {children}
      <Sheet open={ask !== null} onClose={() => finish(null)} title="Код двухфакторной защиты">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code.trim())) finish(code.trim()); }}>
          <p className="text-sm text-muted">Для входа в админ-панель введите 6-значный код из приложения-аутентификатора.</p>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
          {ask?.retry && <p className="text-xs text-danger">Неверный код. Проверьте код и попробуйте ещё раз.</p>}
          <Button full type="submit" disabled={code.length !== 6}>Войти</Button>
        </form>
      </Sheet>
    </>
  );
}

function Dashboard() {
  const me=useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['a-stats'], queryFn: () => aget<any>('/stats/overview'), refetchInterval: 30_000 });
  const mon = useQuery({ queryKey: ['a-mon'], queryFn: () => aget<any>('/monitoring'), refetchInterval: 30_000 });
  const attn = useQuery({ queryKey: ['a-attention'], queryFn: () => aget<AttentionDTO>('/attention'), refetchInterval: 30_000 });
  const cnt = (path: string) => attn.data?.items.find((i) => i.mini === path)?.count ?? 0;
  const mt = useMutation({
    mutationFn: (enabled: boolean) => apost('/maintenance', { enabled }),
    onSuccess: () => { haptic('success'); void qc.invalidateQueries({ queryKey: ['a-mon'] }); void qc.invalidateQueries({ queryKey: ['config'] }); },
    onError: (e) => toast(err(e), 'error'),
  });
  if (s.isError) return <ErrorState message={err(s.error)} onRetry={() => s.refetch()} />;
  const d = s.data;
  const down = (mon.data?.state ?? []).filter((x: any) => x.status === 'down');
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Админ-панель" subtitle="Сводка и быстрые действия" />
      {!!attn.data?.items.length && (
        <Card className="space-y-1 border-danger/50 bg-danger/10 p-2" role="alert">
          <div className="flex items-center gap-2 px-2 pt-1 text-sm font-bold text-danger"><span className="alert-dot sm" />Требует внимания</div>
          {attn.data.items.map((i) => (
            <Link key={i.key} to={i.mini} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm transition active:bg-danger/10">
              <span className="min-w-0 flex-1">{i.title}{i.key === 'down' && down.length ? `: ${down.map((x: any) => x.label).join(', ')}` : ''}</span>
              <span className="alert-dot">{i.count > 99 ? '99+' : i.count}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </Link>
          ))}
        </Card>
      )}
      {!d ? <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 !rounded-card" />)}</div> : (
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label="Выручка сегодня" value={formatRub(d.revenue.today)} icon={<TrendingUp className="h-4 w-4" />} tone="success" sub={`30 дн.: ${formatRub(d.revenue.d30)}`} />
          <KpiTile label="Активных подписок" value={d.subscriptions.active} icon={<Users className="h-4 w-4" />} sub={`пробных: ${d.subscriptions.trial}`} />
          <KpiTile label="Новых за сутки" value={d.users.new_1d} sub={`всего ${d.users.total}`} />
          <KpiTile label="Конверсия триала" value={`${d.trialConversion}%`} tone={d.unfulfilledPayments ? 'danger' : 'primary'} sub={d.unfulfilledPayments ? `не выдано: ${d.unfulfilledPayments}` : `заканчиваются: ${d.subscriptions.expiring}`} />
        </div>
      )}
      <Card className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning"><Wrench className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><div className="font-semibold">Технические работы</div><div className="text-sm text-muted">Блокируют покупки и пополнения</div></div>
        <Switch checked={Boolean(mon.data?.maintenance)} onChange={(v) => mt.mutate(v)} disabled={mt.isPending || !mon.data} />
      </Card>
      <Card className="divide-y divide-border">
        {me.data?.adminRole&&ROLE_LEVEL[me.data.adminRole]>=ROLE_LEVEL.support&&<NavItem to="/admin/support" alert={cnt('/admin/support')} icon={<Headset className="h-5 w-5"/>} label="Поддержка" hint="Обращения, фото, статусы и срочность"/>}
        <NavItem to="/admin/activity" icon={<Eye className="h-5 w-5" />} label="Активность" hint="Кто онлайн, события, последние визиты" />
        <NavItem to="/admin/referrals" icon={<Network className="h-5 w-5" />} label="Рефералы" hint="Кто кого привёл и когда" />
        <NavItem to="/admin/withdrawals" alert={cnt('/admin/withdrawals')} icon={<Banknote className="h-5 w-5" />} label="Выводы" hint="Заявки на вывод реферальных денег" />
        <NavItem to="/admin/users" icon={<Users className="h-5 w-5" />} label="Пользователи" hint="Поиск, дни, баланс, бан" />
        <NavItem to="/admin/payments" alert={cnt('/admin/payments')} icon={<CreditCard className="h-5 w-5" />} label="Платежи" hint="Последние операции, перепроверка" />
        <NavItem to="/admin/network" alert={cnt('/admin/network')} icon={<Network className="h-5 w-5" />} label="Доступность" hint="Операторы и проба по ключу" />
        <NavItem to="/admin/monitoring" alert={cnt('/admin/monitoring')} icon={<Activity className="h-5 w-5" />} label="Мониторинг" hint={down.length ? `Проблем: ${down.length}` : 'Всё в порядке'} />
      </Card>
    </div>
  );
}

const agoAdm = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return 'только что';
  if (m < 60) return `${m} мин`;
  if (m < 1440) return `${Math.round(m / 60)} ч`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};
const EV_ICON: Record<string, { icon: React.ReactNode; cls: string }> = {
  signup: { icon: <UserPlus className="h-4 w-4" />, cls: 'bg-primary/15 text-primary' },
  payment: { icon: <CreditCard className="h-4 w-4" />, cls: 'bg-success/15 text-success' },
  wheel: { icon: <Disc3 className="h-4 w-4" />, cls: 'bg-danger/15 text-danger' },
  quest: { icon: <Eye className="h-4 w-4" />, cls: 'bg-warning/15 text-warning' },
};
const SUB_LABEL: Record<string, string> = { active: 'подписка', trial: 'пробный', expired: 'истекла', none: 'нет подписки' };

function ActivityPage() {
  const q = useQuery({ queryKey: ['a-activity'], queryFn: () => aget<ActivityDTO>('/activity'), refetchInterval: 30_000 });
  const [tab, setTab] = useState<'events' | 'users'>('events');
  if (q.isError) return <ErrorState message={err(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const s = d?.summary;
  const maxV = Math.max(1, ...(d?.series.map((x) => x.signups + x.payments + x.engagement) ?? [1]));
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Активность" subtitle="Кто и что делает в сервисе сейчас" />
      {!s ? <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 !rounded-card" />)}</div> : (
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label="В VPN сейчас" value={s.vpnOnline ?? '—'} icon={<Wifi className="h-4 w-4" />} tone="success" sub="по данным нод" />
          <KpiTile label="За час" value={s.online1h} icon={<Eye className="h-4 w-4" />} sub="заходили в бот/апп" />
          <KpiTile label="За сутки" value={s.active1d} icon={<Users className="h-4 w-4" />} sub={`неделя: ${s.active7d}`} />
          <KpiTile label="Новых за сутки" value={s.new1d} icon={<UserPlus className="h-4 w-4" />} sub={`платили за 30 дн.: ${s.paying30d}`} />
        </div>
      )}
      {d && (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between"><span className="font-semibold">14 дней</span><span className="text-xs text-muted">регистрации · оплаты · бонусы</span></div>
          <div className="flex h-24 items-end gap-1">
            {d.series.map((x) => {
              const tot = x.signups + x.payments + x.engagement;
              return (
                <div key={x.day} className="flex flex-1 flex-col justify-end" title={`${x.day}: ${x.signups} / ${x.payments} / ${x.engagement}`} style={{ height: '100%' }}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${Math.max(tot ? 6 : 2, (tot / maxV) * 100)}%` }}>
                    <div className="bg-success" style={{ flex: x.signups }} />
                    <div className="bg-primary" style={{ flex: x.payments }} />
                    <div className="bg-warning" style={{ flex: x.engagement }} />
                    {!tot && <div className="flex-1 bg-surface-2" />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-3 text-[11px] text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-success" />регистрации</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />оплаты</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warning" />бонусы</span></div>
        </Card>
      )}
      <div className="flex gap-2">
        {([['events', 'События'], ['users', 'Недавно заходили']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('flex-1 rounded-full border px-3 py-2 text-sm font-semibold transition', tab === k ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted')}>{l}</button>
        ))}
      </div>
      {!d ? <Skeleton className="h-48 !rounded-card" /> : tab === 'events' ? (
        <Card className="divide-y divide-border">
          {d.events.length === 0 && <div className="p-5 text-center text-sm text-muted">Пока ничего не происходило</div>}
          {d.events.map((e, i) => (
            <div key={i} className="flex items-center gap-3 p-3 text-sm">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', EV_ICON[e.type]?.cls)}>{EV_ICON[e.type]?.icon}</span>
              <span className="min-w-0 flex-1 leading-snug"><b className="break-words">{e.name}</b> <span className="text-muted">{e.detail}</span>{e.amount ? <b> {formatRub(e.amount)}</b> : null}</span>
              <span className="shrink-0 text-xs text-muted">{agoAdm(e.at)}</span>
            </div>
          ))}
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {d.recent.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1"><span className="block break-words font-semibold leading-tight">{u.name}{u.banned ? ' 🚫' : ''}</span><span className="text-xs text-muted">{SUB_LABEL[u.subState] ?? u.subState}</span></span>
              <span className="shrink-0 text-xs text-muted">{agoAdm(u.lastSeenAt)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function NavItem({ to, icon, label, hint, alert }: { to: string; icon: React.ReactNode; label: string; hint?: string; alert?: number }) {
  return (
    <Link to={to} className="flex items-center gap-3 p-4 transition hover:bg-surface-2">
      <span className="text-primary">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span>{hint && <span className="block truncate text-xs text-muted">{hint}</span>}</span>
      {alert ? <span className="alert-dot" aria-label={`Требует внимания: ${alert}`}>{alert > 99 ? '99+' : alert}</span> : null}
      <ChevronRight className="h-5 w-5 text-muted" />
    </Link>
  );
}

function UsersPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['a-users', term], queryFn: () => aget<{ items: any[] }>(`/users?limit=20&q=${encodeURIComponent(term)}`) });
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Пользователи" />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim().replace(/^@/, '')); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="@username, TG ID или имя" />
        <Button icon={<Search className="h-4 w-4" />} type="submit">Найти</Button>
      </form>
      {list.isLoading ? <Skeleton className="h-40" /> : list.isError ? <ErrorState message={err(list.error)} onRetry={() => list.refetch()} /> : !list.data?.items.length ? <Card><EmptyState title="Никого не нашли" /></Card> : (
        <Card className="divide-y divide-border">
          {list.data.items.map((u) => (
            <button key={u.id} onClick={() => setSel(u.id)} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{u.first_name ?? '—'} {u.username && <span className="text-muted">@{u.username}</span>}</div>
                <div className="text-xs text-muted">{u.expires_at ? (new Date(u.expires_at) > new Date() ? `до ${new Date(u.expires_at).toLocaleDateString('ru-RU')}` : 'истекла') : 'без подписки'} · {formatRub(u.balance)}</div>
              </div>
              {u.status === 'banned' && <Badge tone="danger">бан</Badge>}
              <ChevronRight className="h-4 w-4 text-muted" />
            </button>
          ))}
        </Card>
      )}
      <UserSheet id={sel} onClose={() => setSel(null)} onOpen={setSel} />
    </div>
  );
}

function UserSheet({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen?: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const r = useQuery({ queryKey: ['a-user', id], queryFn: () => aget<any>(`/users/${id}`), enabled: Boolean(id) });
  const [busy, setBusy] = useState('');
  async function act(key: string, path: string, body: unknown, ok: string) {
    setBusy(key);
    try {
      await apost(`/users/${id}${path}`, body);
      haptic('success');
      toast(ok, 'success');
      await r.refetch();
      void qc.invalidateQueries({ queryKey: ['a-users'] });
    } catch (e) {
      haptic('error');
      toast(err(e), 'error');
    } finally {
      setBusy('');
    }
  }
  const u = r.data?.user;
  const s = r.data?.subscription;
  return (
    <Sheet open={Boolean(id)} onClose={onClose} title={u ? `${u.first_name ?? 'Пользователь'}${u.username ? ' @' + u.username : ''}` : 'Пользователь'}>
      {r.isError ? <ErrorState message={err(r.error)} onRetry={() => r.refetch()} /> : !u ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <div className="space-y-1 rounded-btn bg-surface-2 p-4 text-sm">
            <div>TG ID: <b>{u.tg_id ?? '—'}</b> {u.status === 'banned' && <Badge tone="danger">заблокирован</Badge>}</div>
            <div>{s.state === 'none' ? 'Подписки нет' : <>Подписка: <b>{s.planName ?? '—'}</b> до {new Date(s.expiresAt).toLocaleDateString('ru-RU')}</>}</div>
            <div>Трафик: {bytesToHuman(s.trafficUsedBytes)}{s.trafficLimitBytes ? ` / ${bytesToHuman(s.trafficLimitBytes)}` : ' · безлимит'} · устройств: {deviceLimitLabel(s.deviceLimit)}</div>
            <div>Баланс: <b>{formatRub(u.balance)}</b>{u.discount_pct ? ` · скидка ${u.discount_pct}%` : ''} · приглашено: {r.data.invited}</div>
          </div>
          <div className="mini-admin-actions grid grid-cols-2 gap-2">
            <Button variant="secondary" loading={busy === 'd7'} onClick={() => act('d7', '/extend', { days: 7 }, '+7 дней выдано')}>+7 дней</Button>
            <Button variant="secondary" loading={busy === 'd30'} onClick={() => act('d30', '/extend', { days: 30 }, '+30 дней выдано')}>+30 дней</Button>
            <Button variant="secondary" loading={busy === 'b1'} onClick={() => act('b1', '/balance', { amount: 10000, note: 'Начислено из Mini App' }, '+100 ₽ на баланс')}>+100 ₽</Button>
            <Button variant="secondary" loading={busy === 'b5'} onClick={() => act('b5', '/balance', { amount: 50000, note: 'Начислено из Mini App' }, '+500 ₽ на баланс')}>+500 ₽</Button>
            <Button variant="secondary" loading={busy === 'rl'} onClick={() => act('rl', '/reset-link', {}, 'Ссылка подписки сброшена')}>Сбросить ссылку</Button>
            <Button variant={u.status === 'banned' ? 'secondary' : 'danger'} loading={busy === 'ban'} onClick={() => act('ban', '/ban', { banned: u.status !== 'banned' }, u.status === 'banned' ? 'Разблокирован' : 'Заблокирован')}>{u.status === 'banned' ? 'Разблокировать' : 'Заблокировать'}</Button>
          </div>
          <RefBlock userId={id!} onOpen={onOpen} />
          {r.data.payments?.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-medium">Последние платежи</div>
              <ul className="space-y-1 text-sm text-muted">{r.data.payments.slice(0, 5).map((p: any) => <li key={p.id} className="flex justify-between"><span>{p.plan_name ?? paymentPurposeLabel(p.purpose ?? 'topup')} · {paymentStatusLabel(p.status)}</span><span>{formatRub(p.amount)}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

const SUB_LBL: Record<string, string> = { active: 'подписка', trial: 'триал', expired: 'истекла', none: 'без подписки' };
const dt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

function RefBlock({ userId, onOpen }: { userId: string; onOpen?: (id: string) => void }) {
  const q = useQuery({ queryKey: ['a-ref', userId], queryFn: () => aget<any>(`/users/${userId}/referrals`) });
  const [l2, setL2] = useState(false);
  if (q.isLoading) return <Skeleton className="h-20" />;
  const t = q.data;
  if (!t) return null;
  const list = l2 ? t.level2 : t.level1;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Рефералы</div>
      <div className="rounded-btn bg-surface-2 p-3 text-sm">
        {t.referrer ? <button type="button" className="text-left" onClick={() => onOpen?.(t.referrer.id)}>Пригласил: <b>{t.referrer.name}</b>{t.referrer.username ? ` @${t.referrer.username}` : ''} ›</button> : <span className="text-muted">Пришёл сам</span>}
        <div className="mt-1 text-xs text-muted">Привёл {t.totals.level1} (оплатили {t.totals.paid}) · 2 ур.: {t.totals.level2} · заработал {formatRub(t.totals.earnedBalance)}{t.totals.earnedDays ? ` + ${t.totals.earnedDays} дн.` : ''}</div>
      </div>
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => setL2(false)} className={cn('rounded-full px-3 py-1', !l2 ? 'bg-primary text-white' : 'bg-surface-2 text-muted')}>Привёл</button>
        <button type="button" onClick={() => setL2(true)} className={cn('rounded-full px-3 py-1', l2 ? 'bg-primary text-white' : 'bg-surface-2 text-muted')}>Друзья друзей</button>
      </div>
      {list.length === 0 ? <p className="text-xs text-muted">Пока никого</p> : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-btn bg-surface-2">
          {list.map((n: any) => (
            <li key={n.id}><button type="button" onClick={() => onOpen?.(n.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm">
              <span className="min-w-0"><span className="block truncate">{n.name}{n.username ? ` @${n.username}` : ''}</span><span className="text-xs text-muted">{dt(n.joinedAt)}{l2 && n.via ? ` · через ${n.via.name}` : ''}</span></span>
              <span className="shrink-0 text-xs">{n.paid ? '💰 ' : ''}{SUB_LBL[n.sub]}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReferralsFeed() {
  const q = useQuery({ queryKey: ['a-ref-feed'], queryFn: () => aget<any[]>('/referrals/feed'), refetchInterval: 60_000 });
  const [sel, setSel] = useState<string | null>(null);
  if (q.isError) return <ErrorState message={err(q.error)} onRetry={() => q.refetch()} />;
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Рефералы" subtitle="Кто кого привёл — последние регистрации" />
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? <Card><EmptyState title="Пока никого" text="Здесь появятся регистрации по реферальным ссылкам." /></Card> : (
        <Card className="divide-y divide-border">
          {q.data.map((f) => (
            <button key={f.id} type="button" onClick={() => setSel(f.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
              <div className="min-w-0"><div className="truncate font-medium">{f.name}{f.username ? <span className="text-muted"> @{f.username}</span> : ''}</div><div className="truncate text-xs text-muted">← {f.referrer.name} · {dt(f.joinedAt)}</div></div>
              <Badge tone={f.paid ? 'success' : f.sub === 'trial' ? 'primary' : 'neutral'}>{f.paid ? 'оплатил' : SUB_LBL[f.sub] ?? f.sub}</Badge>
            </button>
          ))}
        </Card>
      )}
      <UserSheet id={sel} onClose={() => setSel(null)} onOpen={setSel} />
    </div>
  );
}

function WithdrawalsPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['a-wd'], queryFn: () => aget<any[]>('/withdrawals?status=pending'), refetchInterval: 30_000 });
  const [busy, setBusy] = useState('');
  async function act(id: string, action: 'paid' | 'reject') {
    if (action === 'paid' && !window.confirm('Вы уже перевели деньги пользователю? Заявка будет закрыта.')) return;
    setBusy(id + action);
    try {
      await apost(`/withdrawals/${id}/${action}`, action === 'reject' ? { note: 'Заявка отклонена администратором' } : {});
      haptic('success');
      toast(action === 'paid' ? 'Отмечено как выплаченное' : 'Заявка отклонена, деньги вернулись на счёт', 'success');
      await q.refetch();
    } catch (e) {
      haptic('error');
      toast(err(e), 'error');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Выводы" subtitle="Заявки на вывод реферальных денег" />
      {q.isLoading ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={err(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? <Card><EmptyState title="Заявок нет" text="Когда пользователь запросит вывод, заявка появится здесь и придёт в Telegram." /></Card> : (
        <div className="space-y-3">
          {q.data.map((w) => (
            <Card key={w.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate font-medium">{w.name ?? '—'}{w.username ? <span className="text-muted"> @{w.username}</span> : ''}</div><div className="text-xs text-muted">{dt(w.createdAt)} · TG {w.tgId ?? '—'}</div></div>
                <div className="text-right"><div className="num text-lg font-bold">{formatRub(w.payout)}</div>{w.fee > 0 && <div className="text-xs text-muted">комиссия {formatRub(w.fee)}</div>}</div>
              </div>
              <div className="rounded-btn bg-surface-2 p-3 text-sm"><div className="text-xs text-muted">{w.method || 'Способ не указан'}</div><div className="break-all font-mono">{w.details}</div></div>
              <div className="grid grid-cols-2 gap-2">
                <Button loading={busy === w.id + 'paid'} onClick={() => act(w.id, 'paid')}>Выплачено</Button>
                <Button variant="danger" loading={busy === w.id + 'reject'} onClick={() => act(w.id, 'reject')}>Отклонить</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentsPage() {
  const toast = useToast();
  const p = useQuery({ queryKey: ['a-pay'], queryFn: () => aget<{ items: any[] }>('/payments?limit=25') });
  async function recheck(id: string) {
    try {
      await apost(`/payments/${id}/recheck`);
      haptic('success');
      toast('Перепроверено', 'success');
      void p.refetch();
    } catch (e) {
      toast(err(e), 'error');
    }
  }
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Платежи" subtitle="Последние 25" />
      {p.isLoading ? <Skeleton className="h-48" /> : p.isError ? <ErrorState message={err(p.error)} onRetry={() => p.refetch()} /> : !p.data?.items.length ? <Card><EmptyState title="Платежей пока нет" /></Card> : (
        <Card className="divide-y divide-border">
          {p.data?.items.map((x) => (
            <div key={x.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.plan_name ?? paymentPurposeLabel(x.purpose ?? 'topup')} · {x.username ? '@' + x.username : x.tg_id}</div>
                <div className="text-xs text-muted">{x.provider} · {new Date(x.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{x.fulfill_error ? ' · ошибка выдачи' : ''}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm font-semibold">{formatRub(x.amount)}</div>
                <Badge tone={x.status === 'succeeded' ? (x.fulfilled_at ? 'success' : 'danger') : x.status === 'pending' ? 'warning' : 'neutral'}>{x.status === 'succeeded' && !x.fulfilled_at ? 'не выдано' : paymentStatusLabel(x.status)}</Badge>
              </div>
              {(x.status === 'pending' || (x.status === 'succeeded' && !x.fulfilled_at)) && <Button size="sm" variant="secondary" onClick={() => recheck(x.id)}>↻</Button>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function NetworkPage() {
  const q = useQuery({ queryKey: ['a-net'], queryFn: () => aget<any>('/net?minutes=60'), refetchInterval: 30_000 });
  const d = q.data;
  const byOp = new Map<string, { n: number; ok: number }>();
  for (const r of d?.rows ?? []) { const v = byOp.get(r.operator) ?? { n: 0, ok: 0 }; v.n += r.samples; v.ok += (r.okPct / 100) * r.samples; byOp.set(r.operator, v); }
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Доступность" subtitle="Замеры клиентов за час и проба по ключу" />
      {q.isLoading ? <Skeleton className="h-48" /> : q.isError || !d ? <ErrorState message={err(q.error)} onRetry={() => q.refetch()} /> : (
        <>
          {d.issues.length > 0 && (
            <Card className="space-y-1 border-danger/50 bg-danger/10 p-4 text-sm" role="alert">
              <div className="flex items-center gap-2 font-bold text-danger"><span className="alert-dot sm" />Проблемы сейчас</div>
              {d.issues.map((i: any) => <div key={i.operator + i.target}>{d.labels[i.operator] ?? i.operator}: {i.target} — {i.okPct}% из {i.samples}</div>)}
            </Card>
          )}
          <Card className="divide-y divide-border">
            {byOp.size === 0 && <div className="p-4 text-sm text-muted">Замеров за час нет. Они приходят, когда клиенты открывают приложение.</div>}
            {[...byOp].map(([op, v]) => { const pct = Math.round((v.ok / v.n) * 100); return (
              <div key={op} className="flex items-center gap-3 p-4">
                <span className={cn('inline-block h-2.5 w-2.5 rounded-full', pct >= 90 ? 'bg-success' : pct >= 60 ? 'bg-warning' : 'bg-danger')} />
                <div className="min-w-0 flex-1 font-medium">{d.labels[op] ?? op}</div>
                <span className="text-sm">{pct}% <span className="text-xs text-muted">({v.n})</span></span>
              </div>
            ); })}
          </Card>
          {d.probes.length > 0 && (
            <Card className="divide-y divide-border">
              {d.probes.map((p: any) => (
                <div key={p.probe + p.target} className="flex items-center gap-3 p-4 text-sm">
                  <span className={cn('inline-block h-2.5 w-2.5 rounded-full', p.ok ? 'bg-success' : 'bg-danger')} />
                  <div className="min-w-0 flex-1"><div className="font-medium">{p.target}</div><div className="text-xs text-muted">{p.probe}</div></div>
                  <span className="text-xs text-muted">{p.ok ? `${p.ms ?? '—'} мс` : p.detail ?? 'не работает'}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function MonitoringPage() {
  const toast = useToast();
  const m = useQuery({ queryKey: ['a-mon'], queryFn: () => aget<any>('/monitoring'), refetchInterval: 20_000 });
  const run = useMutation({ mutationFn: () => apost('/monitoring/run'), onSuccess: () => { toast('Проверка выполнена', 'success'); void m.refetch(); }, onError: (e) => toast(err(e), 'error') });
  const dot = (st: string) => <span className={cn('inline-block h-2.5 w-2.5 rounded-full', st === 'up' ? 'bg-success' : st === 'down' ? 'bg-danger' : 'bg-muted')} />;
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Мониторинг" right={<Button size="sm" loading={run.isPending} onClick={() => run.mutate()}>Проверить</Button>} />
      {m.isLoading ? <Skeleton className="h-48" /> : m.isError || !m.data ? <ErrorState message={err(m.error)} onRetry={() => m.refetch()} /> : (
        <>
          <Card className="divide-y divide-border">
            {m.data.state.length === 0 && <div className="p-4 text-sm text-muted">Данных пока нет — проверка запускается раз в минуту.</div>}
            {m.data.state.map((s: any) => (
              <div key={s.target} className="flex items-center gap-3 p-4">
                {dot(s.status)}
                <div className="min-w-0 flex-1"><div className="font-medium">{s.label}</div>{s.detail && <div className="truncate text-xs text-muted">{s.detail}</div>}</div>
                <span className="text-xs text-muted">{s.checked_at ? new Date(s.checked_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            ))}
          </Card>
          {m.data.events.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 font-semibold">События</div>
              <ul className="space-y-1.5 text-sm">{m.data.events.slice(0, 10).map((e: any) => <li key={e.id} className="flex items-center gap-2">{dot(e.status)}<span className="flex-1 truncate">{e.label}</span><span className="text-xs text-muted">{new Date(e.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></li>)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

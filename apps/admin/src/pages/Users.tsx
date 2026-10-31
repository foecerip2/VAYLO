import { UserLte } from '../components/UserLte';
import { Badge, Button, Card, Field, Input, Select, Sheet, Skeleton, Tabs, useToast } from '@vpn/ui';
import { bytesToHuman } from '@vpn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarPlus, Gift, KeyRound, Search, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefTree } from '../components/RefTree';
import { DataTable, Pagination, PageTitle, Row, type Column } from '../components/kit';
import { ApiError, get, post, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { paymentPurposeLabel } from '@vpn/shared';
import { PROVIDER_LABEL, STATUS_LABEL, fmtDate, fmtDateTime, rub } from '../lib/format';

type Filter = 'all' | 'active' | 'trial' | 'expired' | 'none' | 'banned';
interface UserRow { id: string; tg_id: number | null; username: string | null; first_name: string | null; balance: number; status: string; created_at: string; bot_blocked: boolean; expires_at: string | null; is_trial: boolean | null; plan_name: string | null }

function subBadge(u: UserRow) {
  if (u.status === 'banned') return <Badge tone="danger">Заблокирован</Badge>;
  if (!u.expires_at) return <Badge>Нет подписки</Badge>;
  if (new Date(u.expires_at) < new Date()) return <Badge tone="danger">Истекла</Badge>;
  return <Badge tone={u.is_trial ? 'primary' : 'success'}>{u.is_trial ? 'Триал' : 'Активна'}</Badge>;
}

export default function Users() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('userId');
  const setOpenId = (id: string | null) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    if (id) next.set('userId', id); else next.delete('userId');
    return next;
  });
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const q = useQuery({ queryKey: ['users', filter, debounced, page], queryFn: () => get<{ total: number; page: number; limit: number; items: UserRow[] }>(`/users?filter=${filter}&q=${encodeURIComponent(debounced)}&page=${page}`), placeholderData: (p) => p });

  const cols: Column<UserRow>[] = [
    { key: 'u', header: 'Пользователь', primary: true, render: (u) => <div><div className="font-medium">{u.first_name ?? '—'} {u.username && <span className="font-normal text-muted">@{u.username}</span>}</div><div className="text-xs text-muted">TG {u.tg_id ?? '—'}</div></div> },
    { key: 's', header: 'Подписка', render: subBadge },
    { key: 'p', header: 'Тариф', render: (u) => u.plan_name ?? '—' },
    { key: 'e', header: 'До', render: (u) => fmtDate(u.expires_at) },
    { key: 'b', header: 'Баланс', render: (u) => rub(u.balance), align: 'right' },
    { key: 'c', header: 'Регистрация', render: (u) => fmtDate(u.created_at) },
  ];

  return (
    <div className="animate-fade-up">
      <PageTitle title="Пользователи" subtitle={q.data ? `Всего: ${q.data.total}` : undefined} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={filter} onChange={(f) => { setFilter(f); setPage(1); }} items={[{ value: 'all', label: 'Все' }, { value: 'active', label: 'Активные' }, { value: 'trial', label: 'Триал' }, { value: 'expired', label: 'Истекли' }, { value: 'none', label: 'Без подписки' }, { value: 'banned', label: 'Баны' }]} />
        <div className="relative md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Поиск: имя, @username, TG ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <DataTable columns={cols} rows={q.data?.items} loading={q.isLoading} onRowClick={(u) => setOpenId(u.id)} empty="Пользователи не найдены" />
      {q.data && <Pagination page={q.data.page} limit={q.data.limit} total={q.data.total} onChange={setPage} />}
      <UserSheet id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </div>
  );
}

function UserSheet({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => get<any>(`/users/${id}`), enabled: Boolean(id) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get<any[]>('/plans'), enabled: Boolean(id) && can('admin') });
  const [days, setDays] = useState('7');
  const [amount, setAmount] = useState('');
  const [planId, setPlanId] = useState('');
  const [disc, setDisc] = useState('');
  const patchU = useMutation({
    mutationFn: (body: { discountPct?: number }) => patch(`/users/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['user', id] }); toast('Сохранено', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => post<any>(`/users/${id}/${path}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['user', id] }); void qc.invalidateQueries({ queryKey: ['users'] }); toast('Готово', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  const d = q.data;
  const u = d?.user;
  const s = d?.subscription;
  return (
    <Sheet open={Boolean(id)} onClose={onClose} title={u ? `${u.first_name ?? 'Пользователь'}${u.username ? ' @' + u.username : ''}` : 'Пользователь'} wide>
      {!d ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div> : (
        <div className="space-y-5">
          <Card className="p-4">
            <Row label="Telegram ID">{u.tg_id ?? '—'}</Row>
            <Row label="Статус">{u.status === 'banned' ? <Badge tone="danger">Заблокирован</Badge> : <Badge tone="success">Активен</Badge>}</Row>
            <Row label="Подписка">{s.state === 'none' ? 'Нет' : `${s.planName ?? ''} до ${fmtDate(s.expiresAt)} (${s.daysLeft} дн.)`}</Row>
            <Row label="Трафик">{bytesToHuman(s.trafficUsedBytes)}{s.trafficLimitBytes ? ` / ${bytesToHuman(s.trafficLimitBytes)}` : ' · безлимит'}</Row>
            <Row label="Устройств (лимит)">{s.deviceLimit || '—'}{s.extraDevices ? ` (из них докуплено ${s.extraDevices})` : ''}</Row>
            {s.extraTrafficBytes > 0 && <Row label="Докуплено трафика">{bytesToHuman(s.extraTrafficBytes)}</Row>}
            <Row label="Автопродление">{u.auto_renew ? 'включено' : 'выключено'}</Row>
            <Row label="Персональная скидка">{u.discount_pct ? `${u.discount_pct}%` : '—'}</Row>
            <Row label="Баланс">{rub(u.balance)}</Row>
            <Row label="Приглашено">{d.invited}</Row>
            <Row label="Реферальная награда">{u.referral_mode === 'balance' ? 'деньги' : 'дни'}{u.ref_balance > 0 ? ` · на счёте ${rub(u.ref_balance)}` : ''}</Row>
            <Row label="Регистрация">{fmtDateTime(u.created_at)}</Row>
            {s.subUrl && <Row label="Ссылка"><span className="break-all font-mono text-xs">{s.subUrl}</span></Row>}
          </Card>

          <UserLte key={id!} userId={id!}/>
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="space-y-3 p-4">
              <div className="flex items-center gap-2 font-semibold"><CalendarPlus className="h-4 w-4 text-primary" /> Продлить подписку</div>
              <div className="flex gap-2"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /><Button className="shrink-0 whitespace-nowrap" loading={act.isPending} disabled={!Number(days)} onClick={() => act.mutate({ path: 'extend', body: { days: Number(days) } })}>+ дней</Button></div>
            </Card>
            {can('admin') && (
              <Card className="space-y-3 p-4">
                <div className="flex items-center gap-2 font-semibold"><Gift className="h-4 w-4 text-primary" /> Выдать тариф</div>
                <div className="flex gap-2"><Select value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Выберите…</option>{plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Button disabled={!planId} loading={act.isPending} onClick={() => act.mutate({ path: 'grant-plan', body: { planId } })}>Выдать</Button></div>
              </Card>
            )}
            {can('admin') && (
              <Card className="space-y-3 p-4">
                <div className="flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-primary" /> Баланс</div>
                <div className="flex gap-2"><Input inputMode="decimal" placeholder="± сумма в ₽" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ''))} /><Button disabled={!Number(amount)} loading={act.isPending} onClick={() => { act.mutate({ path: 'balance', body: { amount: Math.round(Number(amount) * 100) } }); setAmount(''); }}>Изменить</Button></div>
              </Card>
            )}
            {can('admin') && (
              <Card className="space-y-3 p-4">
                <div className="flex items-center gap-2 font-semibold"><Gift className="h-4 w-4 text-primary" /> Персональная скидка, %</div>
                <div className="flex gap-2"><Input inputMode="numeric" placeholder={`Сейчас ${u.discount_pct}%`} value={disc} onChange={(e) => setDisc(e.target.value.replace(/\D/g, '').slice(0, 3))} /><Button disabled={disc === '' || Number(disc) > 100} loading={patchU.isPending} onClick={() => { patchU.mutate({ discountPct: Number(disc) }); setDisc(''); }}>Задать</Button></div>
                <p className="text-xs text-muted">Действует на тарифы и докупки. 0 — убрать.</p>
              </Card>
            )}
            <Card className="flex flex-wrap items-center gap-2 p-4">
              <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} loading={act.isPending} onClick={() => confirm('Сбросить ссылку подписки пользователя?') && act.mutate({ path: 'reset-link' })}>Сбросить ссылку</Button>
              {can('admin') && <Button variant={u.status === 'banned' ? 'secondary' : 'danger'} icon={<Ban className="h-4 w-4" />} loading={act.isPending} onClick={() => confirm(u.status === 'banned' ? 'Разблокировать?' : 'Заблокировать пользователя и отключить доступ?') && act.mutate({ path: 'ban', body: { banned: u.status !== 'banned' } })}>{u.status === 'banned' ? 'Разблокировать' : 'Заблокировать'}</Button>}
            </Card>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Рефералы</h3>
            <RefTree userId={id!} onOpen={onOpen} />
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Платежи</h3>
            {d.payments.length === 0 ? <p className="text-sm text-muted">Нет платежей</p> : (
              <Card className="divide-y divide-border">
                {d.payments.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0"><div className="truncate font-medium">{p.purpose === 'topup' ? paymentPurposeLabel('topup') : p.plan_name ?? paymentPurposeLabel(p.purpose)} · {PROVIDER_LABEL[p.provider] ?? p.provider}</div><div className="text-xs text-muted">{fmtDateTime(p.created_at)}{p.fulfill_error && <span className="ml-1 text-danger">· ошибка выдачи</span>}</div></div>
                    <div className="text-right"><div className="font-semibold">{rub(p.amount)}</div><Badge tone={STATUS_LABEL[p.status]?.tone}>{STATUS_LABEL[p.status]?.label}</Badge></div>
                  </div>
                ))}
              </Card>
            )}
          </div>
          {d.transactions.length > 0 && (
            <div>
              <h3 className="mb-2 font-semibold">Операции по балансу</h3>
              <Card className="divide-y divide-border">
                {d.transactions.map((t: any, i: number) => <div key={i} className="flex justify-between p-3 text-sm"><span className="text-muted">{fmtDateTime(t.created_at)} · {t.note ?? t.type}</span><span className={t.amount > 0 ? 'font-semibold text-success' : 'font-semibold'}>{t.amount > 0 ? '+' : ''}{rub(t.amount)}</span></div>)}
              </Card>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

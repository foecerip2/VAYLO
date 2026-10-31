import { Badge, Button, Input, Select, Sheet, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Scale, Search } from 'lucide-react';
import { paymentPurposeLabel } from '@vpn/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable, PageTitle, Pagination, type Column } from '../components/kit';
import { ApiError, download, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PROVIDER_LABEL, STATUS_LABEL, fmtDateTime, rub } from '../lib/format';

interface P { id: string; provider: string; method: string | null; purpose: string; amount: number; discount: number; status: string; plan_name: string | null; external_id: string | null; created_at: string; paid_at: string | null; fulfilled_at: string | null; fulfill_error: string | null; username: string | null; tg_id: number | null; first_name: string | null }

interface RecItem { externalId: string; orderId: string | null; amount: number; currency: string }
interface Rec { provider: 'yookassa' | 'rollypay'; providerCount: number; providerTotal: number; providerCurrency: string; localCount: number; localTotalKop: number; fixed: number; unmatched: RecItem[]; localOnly: { id: string; amountKop: number }[]; error?: string }
const money = (v: number, cur: string) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${cur === 'RUB' ? '₽' : cur}`;

function ReconcileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState('30');
  const run = useMutation({
    mutationFn: () => post<{ days: number; results: Rec[] }>('/payments/reconcile', { days: Number(days) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['payments'] }); const n = r.results.reduce((a, x) => a + x.fixed, 0); toast(n ? `Подтянуто платежей: ${n}` : 'Расхождений в статусах нет', n ? 'success' : 'info'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });
  const res = run.data?.results;
  return (
    <Sheet open={open} onClose={onClose} title="Сверка с платёжными системами">
      <div className="space-y-4">
        <p className="text-sm text-muted">Запросит у ЮKassa и RollyPay все успешные платежи за период и сравнит с нашей базой. Оплаченные, но не отмеченные у нас платежи подтянутся автоматически (выдача доступа и зачисление), расхождения будут показаны ниже.</p>
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1"><div className="mb-1.5 text-sm font-medium">Период</div><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option></Select></div>
          <Button loading={run.isPending} icon={<Scale className="h-4 w-4" />} onClick={() => run.mutate()}>Сверить</Button>
        </div>
        {res && res.length === 0 && <div className="rounded-xl bg-fg/[.05] p-4 text-sm text-muted">Не подключена ни одна платёжная система — сверять нечего.</div>}
        {res?.map((r) => {
          const ok = !r.error && r.fixed === 0 && r.unmatched.length === 0 && r.localOnly.length === 0;
          return (
            <div key={r.provider} className="space-y-3 rounded-2xl border border-fg/10 bg-fg/[.04] p-4">
              <div className="flex items-center justify-between gap-2"><b>{PROVIDER_LABEL[r.provider]}</b><Badge tone={r.error ? 'danger' : ok ? 'success' : 'warning'}>{r.error ? 'Ошибка' : ok ? 'Всё сходится' : 'Есть расхождения'}</Badge></div>
              {r.error ? <p className="break-words text-sm text-danger">{r.error}</p> : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-fg/[.05] p-3"><div className="text-xs text-muted">У провайдера</div><div className="num mt-0.5 text-lg font-bold">{money(r.providerTotal, r.providerCurrency)}</div><div className="text-xs text-muted">платежей: {r.providerCount}</div></div>
                    <div className="rounded-xl bg-fg/[.05] p-3"><div className="text-xs text-muted">У нас в базе</div><div className="num mt-0.5 text-lg font-bold">{rub(r.localTotalKop)}</div><div className="text-xs text-muted">платежей: {r.localCount}</div></div>
                  </div>
                  {r.fixed > 0 && <p className="rounded-xl bg-success/10 p-3 text-sm text-success">Подтянуто и выполнено платежей: <b>{r.fixed}</b> — доступ выдан / баланс зачислен.</p>}
                  {r.unmatched.length > 0 && (
                    <div className="text-sm"><div className="mb-1 font-medium">Есть у провайдера, нет у нас ({r.unmatched.length})</div>
                      <ul className="space-y-1 text-xs text-muted">{r.unmatched.slice(0, 20).map((u) => <li key={u.externalId} className="break-all"><span className="font-semibold text-fg">{money(u.amount, u.currency)}</span> · {u.externalId}{u.orderId ? ` · заказ ${u.orderId}` : ''}</li>)}</ul>
                      <p className="mt-1 text-xs text-muted">Обычно это платежи вне бота (ручные ссылки, тесты, другая касса) — к нашим пользователям их привязать нельзя.</p></div>
                  )}
                  {r.localOnly.length > 0 && <p className="text-sm text-muted">Отмечены оплаченными у нас, но не найдены у провайдера: <b className="text-fg">{r.localOnly.length}</b> (ручное подтверждение или тест).</p>}
                  {r.provider === 'rollypay' && <p className="text-xs text-muted">В кабинете RollyPay баланс кассы показан в USDT по курсу на момент зачисления и за вычетом комиссии, поэтому он не равен рублёвой сумме платежей — сравнивайте по рублям и количеству.</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export default function Payments() {
  const [recOpen, setRecOpen] = useState(false);
  const [sp] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const q = useQuery({ queryKey: ['payments', status, provider, debounced, page], queryFn: () => get<{ total: number; page: number; limit: number; items: P[] }>(`/payments?page=${page}&status=${status}&provider=${provider}&q=${encodeURIComponent(debounced)}`), placeholderData: (p) => p });
  const recheck = useMutation({
    mutationFn: (id: string) => post<any>(`/payments/${id}/recheck`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payments'] }); toast('Платёж перепроверен', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });
  const markPaid = useMutation({
    mutationFn: (id: string) => post(`/payments/${id}/mark-paid`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payments'] }); toast('Платёж подтверждён вручную', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  const cols: Column<P>[] = [
    { key: 'd', header: 'Дата', primary: true, render: (p) => fmtDateTime(p.created_at) },
    { key: 'u', header: 'Пользователь', render: (p) => <div><div className="font-medium">{p.first_name ?? '—'}{p.username && <span className="font-normal text-muted"> @{p.username}</span>}</div><div className="text-xs text-muted">TG {p.tg_id ?? '—'}</div></div> },
    { key: 't', header: 'Что', render: (p) => (p.purpose === 'topup' ? paymentPurposeLabel('topup') : p.plan_name ? `${paymentPurposeLabel(p.purpose)}: ${p.plan_name}` : paymentPurposeLabel(p.purpose)) ?? '—' },
    { key: 'pr', header: 'Система', render: (p) => <span>{PROVIDER_LABEL[p.provider] ?? p.provider}{p.method && <span className="text-muted"> · {p.method}</span>}</span> },
    { key: 'a', header: 'Сумма', align: 'right', render: (p) => <span className="font-semibold">{rub(p.amount)}</span> },
    { key: 's', header: 'Статус', render: (p) => <div className="flex flex-wrap gap-1"><Badge tone={STATUS_LABEL[p.status]?.tone}>{STATUS_LABEL[p.status]?.label}</Badge>{p.status === 'succeeded' && !p.fulfilled_at && <Badge tone="warning" className="cursor-help" >не выдан</Badge>}</div> },
    { key: 'x', header: '', align: 'right', render: (p) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {can('admin') && (p.status === 'pending' || (p.status === 'succeeded' && !p.fulfilled_at)) && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={recheck.isPending && recheck.variables === p.id} onClick={() => recheck.mutate(p.id)}>Проверить</Button>}
        {can('owner') && p.status !== 'succeeded' && p.status !== 'refunded' && <Button size="sm" variant="ghost" onClick={() => confirm('Подтвердить платёж вручную и выдать доступ?') && markPaid.mutate(p.id)}>Подтвердить</Button>}
      </div>
    ) },
  ];

  return (
    <div className="animate-fade-up">
      <PageTitle title="Платежи" subtitle={q.data ? `Найдено: ${q.data.total}` : undefined} actions={can('admin') && <div className="flex gap-2"><Button variant="secondary" icon={<Scale className="h-4 w-4" />} onClick={() => setRecOpen(true)}>Сверка</Button><Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('/payments/export.csv', 'payments.csv').catch((e) => toast(e.message, 'error'))}>CSV</Button></div>} />
      <ReconcileSheet open={recOpen} onClose={() => setRecOpen(false)} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Все статусы</option><option value="succeeded">Оплачен</option><option value="pending">Ожидает</option><option value="canceled">Отменён</option><option value="expired">Истёк</option><option value="refunded">Возврат</option></Select>
        <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}><option value="">Все системы</option><option value="yookassa">ЮKassa</option><option value="platega">Platega</option><option value="rollypay">RollyPay</option><option value="balance">Баланс</option><option value="promo">Промокод</option></Select>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="@username, TG ID, ID платежа" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <DataTable columns={cols} rows={q.data?.items} loading={q.isLoading} empty="Платежей нет" />
      {q.data && <Pagination page={q.data.page} limit={q.data.limit} total={q.data.total} onChange={setPage} />}
    </div>
  );
}

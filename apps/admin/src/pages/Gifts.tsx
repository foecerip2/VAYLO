import { Badge, Button, Card, ErrorState, Input, Select, Sheet, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, RefreshCw, Search, ShieldX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, Pagination, PageTitle, type Column } from '../components/kit';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

type GiftState = 'ready' | 'redeemed' | 'revoked';
type Filter = 'all' | GiftState;
interface Person { id: string; name: string | null; tgId: number | null }
interface GiftRow {
  id: string;
  paymentId: string;
  planName: string;
  days: number;
  state: GiftState;
  createdAt: string;
  redeemedAt: string | null;
  buyer: Person;
  recipient: Person | null;
}
interface GiftList { items: GiftRow[]; total: number; page: number; pageSize: number }
const LABEL: Record<GiftState, string> = { ready: 'Готов к активации', redeemed: 'Активирован', revoked: 'Отозван' };
const TONE = { ready: 'primary', redeemed: 'success', revoked: 'neutral' } as const;
const errorText = (e: unknown) => e instanceof ApiError ? e.message : 'Не удалось загрузить подарки';

function PersonCell({ person }: { person: Person | null }) {
  if (!person) return <span className="text-muted">Ещё не активирован</span>;
  return <div className="min-w-0"><div className="max-w-[210px] truncate font-medium" title={person.name ?? undefined}>{person.name || 'Пользователь'}</div><div className="text-xs text-muted">{person.tgId ? `TG ${person.tgId}` : `ID ${person.id}`}</div></div>;
}

export default function GiftsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<GiftRow | null>(null);
  const [revokeError, setRevokeError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({ state: filter, q: debounced, page: String(page) });
  const query = useQuery({
    queryKey: ['admin-gifts', filter, debounced, page],
    queryFn: () => get<GiftList>(`/gifts?${params.toString()}`),
    refetchInterval: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean }>(`/gifts/${id}/revoke`),
    onSuccess: () => {
      setSelected(null);
      setRevokeError('');
      void qc.invalidateQueries({ queryKey: ['admin-gifts'] });
      toast('Подарок отозван. Код больше не действует.', 'success');
    },
    onError: (e) => {
      setRevokeError(e instanceof ApiError ? e.message : 'Не удалось отозвать подарок. Попробуйте ещё раз.');
      void qc.invalidateQueries({ queryKey: ['admin-gifts'] });
    },
  });
  const close = () => { if (!revoke.isPending) { setSelected(null); setRevokeError(''); } };
  const columns: Column<GiftRow>[] = [
    { key: 'gift', header: 'Подарок', primary: true, render: g => <div><div className="font-semibold">{g.planName}</div><div className="mt-0.5 text-xs text-muted">{g.days} дн. · {fmtDateTime(g.createdAt)}</div></div> },
    { key: 'buyer', header: 'Покупатель', render: g => <PersonCell person={g.buyer} /> },
    { key: 'recipient', header: 'Получатель', render: g => <PersonCell person={g.recipient} /> },
    { key: 'state', header: 'Статус', render: g => <div><Badge tone={TONE[g.state]}>{LABEL[g.state]}</Badge>{g.redeemedAt && <div className="mt-1 text-xs text-muted">{fmtDateTime(g.redeemedAt)}</div>}</div> },
    { key: 'payment', header: 'Платёж', render: g => <span className="inline-block max-w-[160px] truncate font-mono text-xs text-muted" title={g.paymentId}>{g.paymentId}</span> },
    { key: 'actions', header: '', align: 'right', render: g => g.state === 'ready' && can('admin') ? <Button size="sm" variant="ghost" icon={<ShieldX className="h-4 w-4 text-danger" />} onClick={() => { setSelected(g); setRevokeError(''); }}>Отозвать</Button> : null },
  ];
  return (
    <div className="animate-fade-up space-y-4">
      <PageTitle title="Подарочные подписки" subtitle="Покупки, активации и получатели. Подарочные коды доступны только покупателям." actions={<Button variant="secondary" size="sm" loading={query.isFetching} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void query.refetch()}>Обновить</Button>} />
      <Card className="flex items-start gap-3 p-4 text-sm text-muted"><Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>Отозвать можно только неактивированный подарок. Отзыв блокирует его код и не возвращает деньги по платежу.</p></Card>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <label className="relative"><span className="sr-only">Поиск подарков</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input className="pl-9" maxLength={120} placeholder="Имя, Telegram ID или ID платежа" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label><span className="sr-only">Статус подарка</span><Select value={filter} onChange={e => {setFilter(e.target.value as Filter); setPage(1);}}><option value="all">Все подарки</option><option value="ready">Готовы к активации</option><option value="redeemed">Активированы</option><option value="revoked">Отозваны</option></Select></label>
      </div>
      {query.isError ? <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} /> : <>
        <DataTable columns={columns} rows={query.data?.items} loading={query.isLoading} empty={debounced || filter !== 'all' ? 'Подарки по этим условиям не найдены' : 'Подарочных подписок пока нет'} />
        {query.data && <Pagination page={page} limit={query.data.pageSize || 25} total={query.data.total} onChange={setPage} />}
      </>}
      <Sheet open={Boolean(selected)} onClose={close} title="Отозвать подарок?">
        {selected && <div className="space-y-4"><p className="text-sm">Подарок «<b>{selected.planName}</b>» покупателя {selected.buyer.name || 'без имени'} больше нельзя будет активировать.</p><p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">Деньги по платежу не возвращаются автоматически. Если нужен возврат, обработайте его отдельно через платёжного провайдера.</p><p className="text-xs text-muted">Уже активированный подарок отозвать здесь нельзя.</p>{revokeError && <p role="alert" className="text-sm text-danger">{revokeError}</p>}<div className="flex gap-3"><Button full variant="secondary" disabled={revoke.isPending} onClick={close}>Отмена</Button><Button full variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate(selected.id)}>Да, отозвать</Button></div></div>}
      </Sheet>
    </div>
  );
}

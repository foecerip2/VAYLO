import { Badge, Button, Card, Field, Input, Sheet, Tabs, useToast } from '@vpn/ui';
import type { WithdrawalDTO } from '@vpn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, type Column } from '../components/kit';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, rub } from '../lib/format';

type Row = WithdrawalDTO & { userId: string; username: string | null; name: string | null; tgId: number | null; processedBy: string | null };
const TONE = { pending: 'warning', paid: 'success', rejected: 'danger' } as const;
const LABEL = { pending: 'Ожидает', paid: 'Выплачено', rejected: 'Отклонено' } as const;

export default function Withdrawals() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [reject, setReject] = useState<Row | null>(null);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['withdrawals', status], queryFn: () => get<Row[]>(`/withdrawals${status === 'pending' ? '?status=pending' : ''}`), refetchInterval: 30000 });
  const act = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'paid' | 'reject'; note?: string }) => post(`/withdrawals/${id}/${action}`, { note }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['withdrawals'] }); setReject(null); setNote(''); toast('Готово', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });
  const cols: Column<Row>[] = [
    { key: 'd', header: 'Дата', render: (r) => fmtDateTime(r.createdAt) },
    { key: 'u', header: 'Пользователь', primary: true, render: (r) => <div><div className="font-medium">{r.name ?? '—'} {r.username && <span className="font-normal text-muted">@{r.username}</span>}</div><div className="text-xs text-muted">TG {r.tgId ?? '—'}</div></div> },
    { key: 'a', header: 'К выплате', align: 'right', render: (r) => <div><b>{rub(r.payout)}</b>{r.fee > 0 && <div className="text-xs text-muted">комиссия {rub(r.fee)}</div>}</div> },
    { key: 'm', header: 'Реквизиты', render: (r) => <div className="max-w-[260px]"><div className="text-xs text-muted">{r.method || '—'}</div><div className="break-all font-mono text-xs">{r.details}</div></div> },
    { key: 's', header: 'Статус', render: (r) => <div><Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>{r.note && <div className="mt-1 text-xs text-muted">{r.note}</div>}</div> },
    { key: 'x', header: '', align: 'right', render: (r) => r.status === 'pending' && can('admin') ? (
      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" icon={<Check className="h-4 w-4" />} loading={act.isPending} onClick={() => confirm(`Вы перевели ${rub(r.payout)} пользователю? Заявка будет закрыта.`) && act.mutate({ id: r.id, action: 'paid' })}>Выплачено</Button>
        <Button size="sm" variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setReject(r)}>Отклонить</Button>
      </div>) : <span className="text-xs text-muted">{r.processedBy ?? ''}</span> },
  ];
  return (
    <div className="animate-fade-up">
      <PageTitle title="Выводы" subtitle="Заявки на вывод реферальных денег. Переведите деньги пользователю по реквизитам и нажмите «Выплачено» — при отказе сумма вернётся на его реферальный счёт." />
      <div className="mb-4"><Tabs value={status} onChange={setStatus} items={[{ value: 'pending', label: 'Ожидают' }, { value: 'all', label: 'Все' }]} /></div>
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} empty={status === 'pending' ? 'Заявок на вывод нет' : 'Выводов ещё не было'} />
      <Sheet open={Boolean(reject)} onClose={() => setReject(null)} title="Отклонить заявку">
        <div className="space-y-4">
          <p className="text-sm text-muted">Сумма {reject ? rub(reject.amount) : ''} вернётся на реферальный счёт пользователя, он получит уведомление.</p>
          <Field label="Причина (увидит пользователь)"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Например: неверные реквизиты" /></Field>
          <Button variant="danger" loading={act.isPending} onClick={() => reject && act.mutate({ id: reject.id, action: 'reject', note: note || undefined })}>Отклонить заявку</Button>
        </div>
      </Sheet>
    </div>
  );
}

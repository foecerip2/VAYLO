import { Badge, Button, Field, Input, Select, Sheet, Switch, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, type Column } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, rub } from '../lib/format';

interface Promo { id: string; code: string; type: 'percent' | 'fixed' | 'days' | 'balance'; value: number; maxUses: number | null; used: number; expiresAt: string | null; isActive: boolean }
const TYPES = { percent: 'Скидка, %', fixed: 'Скидка, ₽', days: 'Бонусные дни', balance: 'Бонус на баланс, ₽' } as const;
const valueLabel = (p: Promo) => (p.type === 'percent' ? `${p.value}%` : p.type === 'days' ? `${p.value} дн.` : rub(p.value));

export default function PromoPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['promo'], queryFn: () => get<Promo[]>('/promo') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', type: 'percent' as Promo['type'], value: '10', maxUses: '', expiresAt: '' });
  const canEdit = can('admin');
  const refresh = () => qc.invalidateQueries({ queryKey: ['promo'] });
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');

  const create = useMutation({
    mutationFn: () => {
      const n = Number(f.value.replace(',', '.'));
      const value = f.type === 'percent' || f.type === 'days' ? Math.round(n) : Math.round(n * 100);
      return post('/promo', { code: f.code.trim(), type: f.type, value, maxUses: f.maxUses ? Number(f.maxUses) : null, expiresAt: f.expiresAt ? new Date(f.expiresAt + 'T23:59:59').toISOString() : null, isActive: true });
    },
    onSuccess: () => { void refresh(); setOpen(false); toast('Промокод создан', 'success'); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (p: Promo) => put(`/promo/${p.id}`, { maxUses: p.maxUses, expiresAt: p.expiresAt, isActive: !p.isActive }),
    onSuccess: () => void refresh(),
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/promo/${id}`), onSuccess: () => { void refresh(); toast('Удалён', 'success'); }, onError });

  const cols: Column<Promo>[] = [
    { key: 'c', header: 'Код', primary: true, render: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    { key: 't', header: 'Тип', render: (p) => TYPES[p.type].split(',')[0] },
    { key: 'v', header: 'Значение', render: valueLabel },
    { key: 'u', header: 'Использований', render: (p) => `${p.used}${p.maxUses ? ` / ${p.maxUses}` : ''}` },
    { key: 'e', header: 'Действует до', render: (p) => fmtDate(p.expiresAt) },
    { key: 's', header: 'Статус', render: (p) => canEdit ? <span onClick={(e) => e.stopPropagation()}><Switch checked={p.isActive} onChange={() => toggle.mutate(p)} label="Активен" /></span> : <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Активен' : 'Выключен'}</Badge> },
    { key: 'x', header: '', align: 'right', render: (p) => canEdit && <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={() => confirm(`Удалить промокод ${p.code}?`) && remove.mutate(p.id)} /> },
  ];
  const valid = f.code.trim().length >= 3 && Number(f.value) > 0;

  return (
    <div className="animate-fade-up">
      <PageTitle title="Промокоды" subtitle="Скидки на оплату и бонусы. Скидка 100% выдаёт тариф бесплатно." actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setF({ code: '', type: 'percent', value: '10', maxUses: '', expiresAt: '' }); setOpen(true); }}>Создать</Button>} />
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} empty="Промокодов пока нет" />
      <Sheet open={open} onClose={() => setOpen(false)} title="Новый промокод">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
          <Field label="Код" hint="Латиница и цифры, без учёта регистра"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" required /></Field>
          <Field label="Тип"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Promo['type'] })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Значение"><Input type="number" min={1} step={f.type === 'percent' || f.type === 'days' ? 1 : 0.01} max={f.type === 'percent' ? 100 : undefined} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Лимит использований" hint="Пусто — без лимита"><Input type="number" min={1} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} /></Field>
            <Field label="Действует до"><Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
          </div>
          <Button type="submit" full loading={create.isPending} disabled={!valid}>Создать</Button>
        </form>
      </Sheet>
    </div>
  );
}

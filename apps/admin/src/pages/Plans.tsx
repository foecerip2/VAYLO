import { Badge, Button, Field, Input, Sheet, Switch, Textarea, useToast } from '@vpn/ui';
import type { PlanDTO } from '@vpn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, type Column } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { rub } from '../lib/format';

interface Form { name: string; description: string; durationDays: string; trafficLimitGb: string; deviceLimit: string; price: string; oldPrice: string; badge: string; sort: string; isActive: boolean }
const empty: Form = { name: '', description: '', durationDays: '30', trafficLimitGb: '0', deviceLimit: '3', price: '199', oldPrice: '', badge: '', sort: '0', isActive: true };
const toForm = (p: PlanDTO): Form => ({ name: p.name, description: p.description, durationDays: String(p.durationDays), trafficLimitGb: String(p.trafficLimitGb), deviceLimit: String(p.deviceLimit), price: String(p.price / 100), oldPrice: p.oldPrice ? String(p.oldPrice / 100) : '', badge: p.badge ?? '', sort: String(p.sort), isActive: p.isActive });
const kop = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);

export default function Plans() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plans'], queryFn: () => get<PlanDTO[]>('/plans') });
  const [editing, setEditing] = useState<PlanDTO | 'new' | null>(null);
  const [f, setF] = useState<Form>(empty);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const canEdit = can('admin');

  const open = (p: PlanDTO | 'new') => { setEditing(p); setF(p === 'new' ? empty : toForm(p)); };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), description: f.description.trim(), durationDays: Number(f.durationDays), trafficLimitGb: Number(f.trafficLimitGb), deviceLimit: Number(f.deviceLimit), price: kop(f.price), oldPrice: f.oldPrice ? kop(f.oldPrice) : null, badge: f.badge.trim() || null, sort: Number(f.sort) || 0, isActive: f.isActive };
      return editing === 'new' ? post('/plans', body) : put(`/plans/${(editing as PlanDTO).id}`, body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); setEditing(null); toast('Тариф сохранён', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/plans/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plans'] }); toast('Тариф удалён', 'success'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error'),
  });

  const cols: Column<PlanDTO>[] = [
    { key: 'n', header: 'Название', primary: true, render: (p) => <span className="flex items-center gap-2">{p.name}{p.badge && <Badge tone="primary">{p.badge}</Badge>}</span> },
    { key: 'd', header: 'Срок', render: (p) => `${p.durationDays} дн.` },
    { key: 't', header: 'Трафик', render: (p) => (p.trafficLimitGb ? `${p.trafficLimitGb} ГБ` : 'Безлимит') },
    { key: 'dev', header: 'Устройства', render: (p) => p.deviceLimit || '∞' },
    { key: 'p', header: 'Цена', align: 'right', render: (p) => <span className="font-semibold">{rub(p.price)}{p.oldPrice ? <s className="ml-1.5 text-xs font-normal text-muted">{rub(p.oldPrice)}</s> : null}</span> },
    { key: 's', header: 'Статус', render: (p) => <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Активен' : 'Скрыт'}</Badge> },
    { key: 'x', header: '', align: 'right', render: (p) => canEdit && (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" aria-label="Изменить" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => open(p)} />
        <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={() => confirm(`Удалить тариф «${p.name}»? Действующие подписки сохранятся.`) && remove.mutate(p.id)} />
      </div>
    ) },
  ];
  const valid = f.name.trim() && Number(f.durationDays) > 0 && Number(f.price) >= 0 && f.price !== '';

  return (
    <div className="animate-fade-up">
      <PageTitle title="Тарифы" subtitle="Цены в рублях. Скрытые тарифы не видны клиентам." actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => open('new')}>Новый тариф</Button>} />
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} empty="Тарифов пока нет" onRowClick={canEdit ? open : undefined} />
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Новый тариф' : 'Редактирование тарифа'}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
          <Field label="Название"><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="1 месяц" required /></Field>
          <Field label="Описание"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} className="min-h-16" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Срок, дней"><Input type="number" min={1} value={f.durationDays} onChange={(e) => set('durationDays', e.target.value)} /></Field>
            <Field label="Трафик, ГБ" hint="0 — безлимит"><Input type="number" min={0} value={f.trafficLimitGb} onChange={(e) => set('trafficLimitGb', e.target.value)} /></Field>
            <Field label="Устройств" hint="0 — без лимита"><Input type="number" min={0} value={f.deviceLimit} onChange={(e) => set('deviceLimit', e.target.value)} /></Field>
            <Field label="Порядок"><Input type="number" value={f.sort} onChange={(e) => set('sort', e.target.value)} /></Field>
            <Field label="Цена, ₽"><Input type="number" min={0} step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="Старая цена, ₽" hint="Зачёркнутая"><Input type="number" min={0} step="0.01" value={f.oldPrice} onChange={(e) => set('oldPrice', e.target.value)} /></Field>
          </div>
          <Field label="Бейдж" hint="Например: «Выгодно»"><Input value={f.badge} maxLength={20} onChange={(e) => set('badge', e.target.value)} /></Field>
          <div className="flex items-center justify-between"><span className="text-sm font-medium">Показывать клиентам</span><Switch checked={f.isActive} onChange={(v) => set('isActive', v)} label="Активен" /></div>
          <Button type="submit" full loading={save.isPending} disabled={!valid}>Сохранить</Button>
        </form>
      </Sheet>
    </div>
  );
}

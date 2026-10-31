import { Badge, Button, Field, Input, Select, Sheet, Switch, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, type Column } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { rub } from '../lib/format';

interface Quest { id: string; title: string; description: string; type: string; target: number; reward_type: 'days' | 'balance'; reward_value: number; repeat: 'once' | 'daily'; config: { url?: string }; sort: number; is_active: boolean; claims: number }
const GB = 1024 ** 3;
const TYPES: Record<string, { label: string; hint: string; unit?: 'rub' | 'gb' }> = {
  daily_checkin: { label: 'Ежедневный бонус', hint: 'Нажатие раз в день; серия увеличивает награду' },
  join_channel: { label: 'Подписка на канал', hint: 'Проверяется по каналам из «Подписка на канал»' },
  invite_friends: { label: 'Пригласить друзей', hint: 'Цель — число приглашённых' },
  first_payment: { label: 'Первая покупка', hint: 'Любой оплаченный тариф' },
  topup_total: { label: 'Пополнить на сумму', hint: 'Цель — сумма пополнений, ₽', unit: 'rub' },
  spend_total: { label: 'Потратить на сумму', hint: 'Цель — сумма покупок, ₽', unit: 'rub' },
  have_subscription: { label: 'Иметь платную подписку', hint: 'Выполнено, пока подписка активна' },
  traffic_used: { label: 'Использовать трафик', hint: 'Цель — ГБ', unit: 'gb' },
  open_link: { label: 'Перейти по ссылке', hint: 'Награда за переход (например, на партнёра)' },
};
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
interface Form { id?: string; title: string; description: string; type: string; target: string; rewardType: 'days' | 'balance'; rewardValue: string; repeat: 'once' | 'daily'; url: string; sort: string; isActive: boolean }
const blank: Form = { title: '', description: '', type: 'invite_friends', target: '1', rewardType: 'balance', rewardValue: '10', repeat: 'once', url: '', sort: '10', isActive: true };

export default function QuestsPage() {
  const { can } = useAuth();
  const canEdit = can('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['quests'], queryFn: () => get<Quest[]>('/quests') });
  const [f, setF] = useState<Form | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['quests'] });

  const save = useMutation({
    mutationFn: (v: Form) => {
      const unit = TYPES[v.type]?.unit;
      const target = unit === 'rub' ? Math.round(Number(v.target) * 100) : unit === 'gb' ? Math.round(Number(v.target) * GB) : Math.round(Number(v.target));
      const rewardValue = v.rewardType === 'balance' ? Math.round(Number(v.rewardValue.replace(',', '.')) * 100) : Math.round(Number(v.rewardValue));
      const body = { title: v.title.trim(), description: v.description.trim(), type: v.type, target, rewardType: v.rewardType, rewardValue, repeat: v.type === 'daily_checkin' ? 'daily' : v.repeat, url: v.url.trim(), sort: Number(v.sort) || 0, isActive: v.isActive };
      return v.id ? put(`/quests/${v.id}`, body) : post('/quests', body);
    },
    onSuccess: () => { void refresh(); setF(null); toast('Квест сохранён', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const toggle = useMutation({
    mutationFn: (x: Quest) => put(`/quests/${x.id}`, { title: x.title, description: x.description, type: x.type, target: x.target, rewardType: x.reward_type, rewardValue: x.reward_value, repeat: x.repeat, url: x.config?.url ?? '', sort: x.sort, isActive: !x.is_active }),
    onSuccess: () => void refresh(),
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/quests/${id}`), onSuccess: () => { void refresh(); toast('Удалён', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });

  const fmtTarget = (x: Quest) => (TYPES[x.type]?.unit === 'rub' ? rub(x.target) : TYPES[x.type]?.unit === 'gb' ? `${Math.round(x.target / GB)} ГБ` : x.type === 'invite_friends' ? x.target : '—');
  const cols: Column<Quest>[] = [
    { key: 't', header: 'Квест', primary: true, render: (x) => <b>{x.title}</b> },
    { key: 'ty', header: 'Тип', render: (x) => TYPES[x.type]?.label ?? x.type },
    { key: 'g', header: 'Цель', render: fmtTarget },
    { key: 'r', header: 'Награда', render: (x) => (x.reward_type === 'days' ? `+${x.reward_value} дн.` : `+${rub(x.reward_value)}`) },
    { key: 're', header: 'Повтор', render: (x) => (x.repeat === 'daily' ? 'ежедневно' : 'один раз') },
    { key: 'c', header: 'Получили', render: (x) => x.claims },
    { key: 's', header: 'Статус', render: (x) => canEdit ? <span onClick={(e) => e.stopPropagation()}><Switch checked={x.is_active} onChange={() => toggle.mutate(x)} label="Активен" /></span> : <Badge tone={x.is_active ? 'success' : 'neutral'}>{x.is_active ? 'Активен' : 'Выкл.'}</Badge> },
    { key: 'x', header: '', align: 'right', render: (x) => canEdit && <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить квест «${x.title}»?`)) remove.mutate(x.id); }} /> },
  ];
  const edit = (x: Quest) => {
    const unit = TYPES[x.type]?.unit;
    setF({ id: x.id, title: x.title, description: x.description, type: x.type, target: String(unit === 'rub' ? x.target / 100 : unit === 'gb' ? Math.round(x.target / GB) : x.target), rewardType: x.reward_type, rewardValue: String(x.reward_type === 'balance' ? x.reward_value / 100 : x.reward_value), repeat: x.repeat, url: x.config?.url ?? '', sort: String(x.sort), isActive: x.is_active });
  };
  const valid = f && f.title.trim() && Number(f.target) > 0 && Number(f.rewardValue) > 0 && (f.type !== 'open_link' || /^https?:\/\//.test(f.url));

  return (
    <div className="animate-fade-up">
      <PageTitle title="Квесты" subtitle="Задания с наградой (дни подписки или деньги на баланс) — повышают вовлечённость и возврат." actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF(blank)}>Создать</Button>} />
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} empty="Квестов пока нет" onRowClick={canEdit ? edit : undefined} />
      <Sheet open={Boolean(f)} onClose={() => setF(null)} title={f?.id ? 'Квест' : 'Новый квест'}>
        {f && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(f); }}>
            <Field label="Название"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
            <Field label="Описание"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Тип задания" hint={TYPES[f.type]?.hint}><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
            {!['daily_checkin', 'join_channel', 'first_payment', 'have_subscription', 'open_link'].includes(f.type) && <Field label={`Цель${TYPES[f.type]?.unit === 'rub' ? ', ₽' : TYPES[f.type]?.unit === 'gb' ? ', ГБ' : ''}`}><Input type="number" min={1} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>}
            {f.type === 'open_link' && <Field label="Ссылка"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Награда"><Select value={f.rewardType} onChange={(e) => setF({ ...f, rewardType: e.target.value as Form['rewardType'] })}><option value="balance">Деньги на баланс, ₽</option><option value="days">Дни подписки</option></Select></Field>
              <Field label={f.rewardType === 'balance' ? 'Сумма, ₽' : 'Дней'}><Input type="number" min={f.rewardType === 'balance' ? 0.01 : 1} step={f.rewardType === 'balance' ? 0.01 : 1} value={f.rewardValue} onChange={(e) => setF({ ...f, rewardValue: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Повтор"><Select value={f.type === 'daily_checkin' ? 'daily' : f.repeat} disabled={f.type === 'daily_checkin'} onChange={(e) => setF({ ...f, repeat: e.target.value as Form['repeat'] })}><option value="once">Один раз</option><option value="daily">Каждый день</option></Select></Field>
              <Field label="Порядок"><Input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
            </div>
            <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Квест активен" />
            <Button type="submit" full loading={save.isPending} disabled={!valid}>Сохранить</Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}

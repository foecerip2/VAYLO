import { Badge, Button, Card, CopyField, Field, Input, KpiTile, Sheet, Switch, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, Section, type Column } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, rub } from '../lib/format';

interface Rank { id: string; name: string; min_paid: number; percent: number; extra_days: number; sort: number }
interface PLink { id: string; code: string; name: string; clicks: number; is_active: boolean; owner_tg_id: number | null; owner_username: string | null; registrations: number; paying: number; revenue: number }
interface Overview { invited: number; paying: number; balance: number; days: number; level2: number; top: { id: string; username: string | null; first_name: string | null; tg_id: number | null; invited: number; paid: number; balance: number; days: number }[] }
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

export default function ReferralsPage() {
  const { can } = useAuth();
  const canEdit = can('admin');
  const ov = useQuery({ queryKey: ['ref-ov'], queryFn: () => get<Overview>('/referrals/overview') });
  return (
    <div className="animate-fade-up space-y-5">
      <PageTitle title="Рефералы" subtitle="Обзор программы, ранги и партнёрские ссылки. Проценты и дни задаются в Настройки → Пробный и рефералы." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Приглашено" value={ov.data?.invited ?? '—'} icon={<Users className="h-4 w-4" />} />
        <KpiTile label="Из них оплатили" value={ov.data?.paying ?? '—'} tone="success" />
        <KpiTile label="Выплачено на баланс" value={ov.data ? rub(ov.data.balance) : '—'} sub={ov.data ? `с 2 уровня: ${rub(ov.data.level2)}` : undefined} tone="warning" />
        <KpiTile label="Выдано дней" value={ov.data?.days ?? '—'} />
      </div>
      <Feed />
      <Ranks canEdit={canEdit} />
      <Partners canEdit={canEdit} />
      <Section title="Топ рефереров">
        <DataTable<Overview['top'][number]> rows={ov.data?.top} loading={ov.isLoading} empty="Пока никто не приводил оплативших друзей" columns={[
          { key: 'u', header: 'Пользователь', primary: true, render: (r) => <>{r.first_name ?? '—'} {r.username && <span className="text-muted">@{r.username}</span>}</> },
          { key: 'i', header: 'Приглашено', render: (r) => r.invited },
          { key: 'p', header: 'Оплатили', render: (r) => r.paid },
          { key: 'b', header: 'Заработал', align: 'right', render: (r) => rub(r.balance) },
          { key: 'd', header: 'Дней', align: 'right', render: (r) => r.days },
        ]} />
      </Section>
    </div>
  );
}

interface FeedItem { id: string; name: string; username: string | null; joinedAt: string; sub: string; paid: boolean; referrer: { id: string; name: string; username: string | null } }
function Feed() {
  const q = useQuery({ queryKey: ['ref-feed'], queryFn: () => get<FeedItem[]>('/referrals/feed'), refetchInterval: 60000 });
  return (
    <Section title="Кто кого привёл" description="Последние регистрации по реферальным ссылкам">
      <DataTable<FeedItem> rows={q.data} loading={q.isLoading} empty="Пока никто не регистрировался по ссылкам" columns={[
        { key: 'w', header: 'Когда', render: (r) => fmtDateTime(r.joinedAt) },
        { key: 'u', header: 'Пришёл', primary: true, render: (r) => <>{r.name} {r.username && <span className="text-muted">@{r.username}</span>}</> },
        { key: 'r', header: 'Его пригласил', render: (r) => <>{r.referrer.name} {r.referrer.username && <span className="text-muted">@{r.referrer.username}</span>}</> },
        { key: 's', header: 'Статус', render: (r) => (r.paid ? <Badge tone="success">оплатил</Badge> : r.sub === 'trial' ? <Badge tone="primary">триал</Badge> : r.sub === 'active' ? <Badge tone="success">подписка</Badge> : <Badge>{r.sub === 'expired' ? 'истекла' : 'без подписки'}</Badge>) },
      ]} />
    </Section>
  );
}

function Ranks({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ranks'], queryFn: () => get<Rank[]>('/referrals/ranks') });
  const [edit, setEdit] = useState<Partial<Rank> | null>(null);
  const save = useMutation({
    mutationFn: (r: Partial<Rank>) => {
      const body = { name: r.name, minPaid: Number(r.min_paid ?? 0), percent: Number(r.percent ?? 0), extraDays: Number(r.extra_days ?? 0), sort: Number(r.sort ?? 0) };
      return r.id ? put(`/referrals/ranks/${r.id}`, body) : post('/referrals/ranks', body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ranks'] }); setEdit(null); toast('Сохранено', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/referrals/ranks/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ranks'] }), onError: (e) => toast(errMsg(e), 'error') });
  const cols: Column<Rank>[] = [
    { key: 'n', header: 'Ранг', primary: true, render: (r) => <b>{r.name}</b> },
    { key: 'm', header: 'От оплативших друзей', render: (r) => r.min_paid },
    { key: 'p', header: 'Доп. процент', render: (r) => (r.percent ? `+${r.percent}%` : '—') },
    { key: 'd', header: 'Доп. дни', render: (r) => (r.extra_days ? `+${r.extra_days}` : '—') },
    { key: 'x', header: '', align: 'right', render: (r) => canEdit && <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить ранг «${r.name}»?`)) remove.mutate(r.id); }} /> },
  ];
  return (
    <Section title="Ранги" description="Чем больше друзей оплатило, тем выше процент и бонусные дни пригласившего." right={canEdit && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', min_paid: 5, percent: 5, extra_days: 0 })}>Добавить</Button>}>
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} onRowClick={canEdit ? (r) => setEdit(r) : undefined} />
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Ранг' : 'Новый ранг'}>
        {edit && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(edit); }}>
            <Field label="Название"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="От друзей"><Input type="number" min={0} value={edit.min_paid ?? 0} onChange={(e) => setEdit({ ...edit, min_paid: Number(e.target.value) })} /></Field>
              <Field label="+ процент"><Input type="number" min={0} max={100} value={edit.percent ?? 0} onChange={(e) => setEdit({ ...edit, percent: Number(e.target.value) })} /></Field>
              <Field label="+ дни"><Input type="number" min={0} value={edit.extra_days ?? 0} onChange={(e) => setEdit({ ...edit, extra_days: Number(e.target.value) })} /></Field>
            </div>
            <Button type="submit" full loading={save.isPending} disabled={!edit.name}>Сохранить</Button>
          </form>
        )}
      </Sheet>
    </Section>
  );
}

function Partners({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plinks'], queryFn: () => get<PLink[]>('/referrals/partner-links') });
  const cfg = useQuery({ queryKey: ['settings'], queryFn: () => get<any>('/settings'), enabled: canEdit });
  const [edit, setEdit] = useState<{ id?: string; code: string; name: string; ownerTgId: string; isActive: boolean } | null>(null);
  const bot = cfg.data?.env?.botUsername as string | undefined;
  const save = useMutation({
    mutationFn: (v: NonNullable<typeof edit>) => {
      const body = { code: v.code.trim(), name: v.name.trim(), ownerTgId: v.ownerTgId ? Number(v.ownerTgId) : null, isActive: v.isActive };
      return v.id ? put(`/referrals/partner-links/${v.id}`, body) : post('/referrals/partner-links', body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plinks'] }); setEdit(null); toast('Сохранено', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/referrals/partner-links/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['plinks'] }), onError: (e) => toast(errMsg(e), 'error') });
  const cols: Column<PLink>[] = [
    { key: 'n', header: 'Ссылка', primary: true, render: (r) => <><b>{r.name}</b> <span className="font-mono text-xs text-muted">{r.code}</span></> },
    { key: 'o', header: 'Владелец', render: (r) => (r.owner_tg_id ? (r.owner_username ? '@' + r.owner_username : r.owner_tg_id) : '—') },
    { key: 'c', header: 'Переходы', render: (r) => r.clicks },
    { key: 'r', header: 'Регистрации', render: (r) => r.registrations },
    { key: 'p', header: 'Платящих', render: (r) => r.paying },
    { key: 'v', header: 'Выручка', align: 'right', render: (r) => rub(r.revenue) },
    { key: 's', header: '', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'активна' : 'выкл.'}</Badge> },
    { key: 'x', header: '', align: 'right', render: (r) => canEdit && <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить ссылку ${r.code}?`)) remove.mutate(r.id); }} /> },
  ];
  const link = edit?.code && bot ? `https://t.me/${bot}?start=ref_${edit.code.toLowerCase()}` : '';
  return (
    <Section title="Партнёрские ссылки" description="Для блогеров и рекламы: своя ссылка со статистикой. Если указать владельца — он получает реферальные награды с приведённых пользователей." right={canEdit && <Button size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => setEdit({ code: '', name: '', ownerTgId: '', isActive: true })}>Создать</Button>}>
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} empty="Партнёрских ссылок пока нет" onRowClick={canEdit ? (r) => setEdit({ id: r.id, code: r.code, name: r.name, ownerTgId: r.owner_tg_id ? String(r.owner_tg_id) : '', isActive: r.is_active }) : undefined} />
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Партнёрская ссылка' : 'Новая ссылка'}>
        {edit && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(edit); }}>
            <Field label="Название" hint="Для вас: «YouTube Вася»"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <Field label="Код ссылки" hint="Латиница, цифры, - и _ (от 3 символов)"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} placeholder="yt-vasya" required /></Field>
            <Field label="Telegram ID владельца" hint="Необязательно. Он должен хотя бы раз заходить в бота."><Input inputMode="numeric" value={edit.ownerTgId} onChange={(e) => setEdit({ ...edit, ownerTgId: e.target.value.replace(/\D/g, '') })} /></Field>
            <Switch checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Ссылка активна" />
            {link && <CopyField value={link} label="Ссылка для бота" />}
            {edit.code && <CopyField value={`${location.origin.replace('admin.', 'app.')}/?ref=${edit.code.toLowerCase()}`} label="Ссылка для сайта" />}
            <Button type="submit" full loading={save.isPending} disabled={!edit.name || edit.code.length < 3}>Сохранить</Button>
          </form>
        )}
      </Sheet>
    </Section>
  );
}

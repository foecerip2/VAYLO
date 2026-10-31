import { Badge, Button, Card, Field, Input, Select, Switch, Textarea, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Send, Trophy } from 'lucide-react';
import { useState } from 'react';
import { GroupForm, Toggle } from '../components/GroupForm';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface Item { id: string; code: string; title: string; status: 'draft' | 'active' | 'finished' | 'cancelled'; prize: string; winnersCount: number; entries: number; winners: number; endsAt: string; link: string }
interface Detail { id: string; title: string; status: Item['status']; entries: number; postPreview: string; link: string; winners: { place: number; status: string; note: string; userId: string; username: string | null; firstName: string | null }[]; posts: { id: string; kind: string; status: string; error: string }[] }
const ST: Record<Item['status'], { t: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = { draft: { t: 'Черновик', tone: 'neutral' }, active: { t: 'Идёт', tone: 'success' }, finished: { t: 'Завершён', tone: 'neutral' }, cancelled: { t: 'Отменён', tone: 'danger' } };
const PRIZE_ST: Record<string, string> = { paid: 'выдан', manual_pending: 'нужно выдать вручную', manual_issued: 'выдан вручную', failed: 'ошибка выдачи', pending: 'ожидает' };
const PRESETS = [
  { id: 'week', title: '7 дней × 5 победителей', sub: 'итоги через 3 дня' },
  { id: 'month', title: '30 дней × 3 победителя', sub: 'итоги через 4 дня' },
  { id: 'cash', title: '300 ₽ на баланс × 5', sub: 'итоги через 3 дня' },
  { id: 'promo', title: 'Скидка 50% × 10', sub: 'итоги через 2 дня' },
] as const;
const err = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const localIn = (h: number) => { const d = new Date(Date.now() + h * 3600_000 - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };

function DetailCard({ id, canEdit }: { id: string; canEdit: boolean }) {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['contest', id], queryFn: () => get<Detail>(`/contests/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['contest', id] }); void qc.invalidateQueries({ queryKey: ['contests'] }); };
  const act = (path: string, ok: string, confirmText?: string) => useMutation({ mutationFn: () => post(`/contests/${id}/${path}`), onSuccess: () => { refresh(); toast(ok, 'success'); }, onError: (e) => toast(err(e), 'error') });
  const finish = act('finish', 'Итоги подведены'); const cancel = act('cancel', 'Конкурс отменён'); const publish = act('publish', 'Опубликовано');
  const issued = useMutation({ mutationFn: (uid: string) => post(`/contests/${id}/winners/${uid}/issued`), onSuccess: refresh, onError: (e) => toast(err(e), 'error') });
  if (q.isLoading || !q.data) return <Sk className="h-24" />;
  const d = q.data;
  return <Card className="space-y-3 p-4 text-sm">
    <div className="flex flex-wrap items-center gap-2"><b>{d.title}</b><Badge tone={ST[d.status].tone}>{ST[d.status].t}</Badge><span className="text-muted">участников: {d.entries}</span></div>
    <div className="whitespace-pre-wrap rounded-xl bg-fg/5 p-3 text-xs" dangerouslySetInnerHTML={{ __html: d.postPreview.replace(/<(?!\/?(b|i|code)>)[^>]*>/g, '') }} />
    {d.link && <p className="break-all text-xs text-muted">Ссылка на участие: {d.link}</p>}
    {d.posts.some((p) => p.status === 'failed') && <p className="text-xs text-danger">Пост не ушёл: {d.posts.find((p) => p.status === 'failed')?.error}. Проверьте, что бот — администратор канала.</p>}
    {d.winners.length > 0 && <div className="space-y-1">{d.winners.map((w) => <div key={w.userId} className="flex flex-wrap items-center gap-2"><Trophy className="h-4 w-4 text-primary" /><span>{w.place}. {w.username ? '@' + w.username : w.firstName}</span><span className="text-xs text-muted">{PRIZE_ST[w.status] ?? w.status}{w.note ? ` · ${w.note}` : ''}</span>{w.status === 'manual_pending' && canEdit && <Button size="sm" variant="ghost" onClick={() => issued.mutate(w.userId)}>Отметить выданным</Button>}</div>)}</div>}
    {canEdit && (d.status === 'draft' || d.status === 'active') && <div className="flex flex-wrap gap-2">
      {d.status === 'draft' && <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={publish.isPending} onClick={() => publish.mutate()}>Опубликовать в канал</Button>}
      {d.status === 'active' && <Button size="sm" loading={finish.isPending} onClick={() => confirm('Подвести итоги прямо сейчас? Победители будут выбраны и уведомлены.') && finish.mutate()}>Подвести итоги сейчас</Button>}
      <Button size="sm" variant="ghost" onClick={() => confirm('Отменить конкурс?') && cancel.mutate()}>Отменить</Button>
    </div>}
  </Card>;
}

export default function Contests() {
  const { can } = useAuth(); const canEdit = can('admin');
  const qc = useQueryClient(); const toast = useToast();
  const list = useQuery({ queryKey: ['contests'], queryFn: () => get<{ channel: string; items: Item[] }>('/contests'), refetchInterval: 30_000 });
  const cfg = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: Record<string, any> }>('/settings') });
  const [open, setOpen] = useState<string | null>(null);
  const quick = useMutation({
    mutationFn: (preset: string) => post<{ id: string; postStatus: string; error: string }>('/contests/quick', { preset }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['contests'] }); setOpen(r.id); r.postStatus === 'failed' ? toast(`Конкурс создан, но пост не ушёл: ${r.error}`, 'error') : toast('Конкурс опубликован в канале', 'success'); },
    onError: (e) => toast(err(e), 'error'),
  });
  const [f, setF] = useState({ title: '', description: '', prizeKind: 'days', prizeValue: 7, prizeText: '', winnersCount: 3, requireChannel: true, endsAt: localIn(72) });
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/contests', { ...f, endsAt: new Date(f.endsAt).toISOString() }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['contests'] }); setOpen(r.id); toast('Черновик создан. Нажмите «Опубликовать в канал».', 'success'); },
    onError: (e) => toast(err(e), 'error'),
  });
  const enabled = !!cfg.data?.settings.contests?.enabled;
  return <div className="space-y-5">
    <PageTitle title="Конкурсы" subtitle="Один клик — пост в канале с кнопкой «Участвовать». Итоги бот подведёт сам в назначенное время." />
    {cfg.isLoading ? <Sk className="h-24" /> : <GroupForm group="contests" data={cfg.data?.settings.contests} title="Настройки" description="Канал: @username или числовой id. Бот должен быть администратором канала с правом публикации." locked={!canEdit}>
      {(v, set) => <div className="space-y-3"><Toggle label="Конкурсы включены" checked={!!v.enabled} onChange={(x) => set('enabled', x)} />
        <Field label="Канал для постов" hint="Пусто — возьмём первый канал из «Обязательной подписки»"><Input value={v.channel} placeholder="@my_channel" onChange={(e) => set('channel', e.target.value)} /></Field>
        <Toggle label="Публиковать итоги в канале" checked={!!v.publish_results} onChange={(x) => set('publish_results', x)} /></div>}
    </GroupForm>}
    {!enabled && !cfg.isLoading && <Card className="p-4 text-sm text-muted">Модуль выключен: включите переключатель выше и сохраните, иначе пользователи не смогут участвовать.</Card>}
    {canEdit && <Section title="Быстрый конкурс" description="Создаёт конкурс и сразу публикует пост в канал.">
      <div className="grid gap-2 sm:grid-cols-2">{PRESETS.map((p) => <button key={p.id} disabled={quick.isPending || !enabled} onClick={() => confirm(`Опубликовать конкурс «${p.title}» в канале прямо сейчас?`) && quick.mutate(p.id)} className="flex items-center gap-3 rounded-2xl border border-fg/10 p-3 text-left transition hover:border-primary disabled:opacity-50"><Gift className="h-5 w-5 shrink-0 text-primary" /><span><b className="block text-sm">{p.title}</b><span className="text-xs text-muted">{p.sub}</span></span></button>)}</div>
    </Section>}
    {canEdit && <Section title="Свой конкурс">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название"><Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Розыгрыш подписок" /></Field>
        <Field label="Итоги (ваше время)"><Input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        <Field label="Приз"><Select value={f.prizeKind} onChange={(e) => setF({ ...f, prizeKind: e.target.value })}><option value="days">Дни подписки</option><option value="balance">Деньги на баланс (₽)</option><option value="discount">Промокод на скидку (%)</option><option value="manual">Другой (выдаю сам)</option></Select></Field>
        {f.prizeKind === 'manual' ? <Field label="Описание приза"><Input value={f.prizeText} onChange={(e) => setF({ ...f, prizeText: e.target.value })} /></Field> : <Field label={f.prizeKind === 'days' ? 'Сколько дней' : f.prizeKind === 'balance' ? 'Сколько рублей' : 'Скидка, %'}><Input type="number" min={1} value={f.prizeValue} onChange={(e) => setF({ ...f, prizeValue: Number(e.target.value) })} /></Field>}
        <Field label="Победителей"><Input type="number" min={1} max={100} value={f.winnersCount} onChange={(e) => setF({ ...f, winnersCount: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><Switch checked={f.requireChannel} onChange={(v) => setF({ ...f, requireChannel: v })} label="Нужна подписка на канал" />Нужна подписка на канал</label>
      </div>
      <Field label="Описание (необязательно)"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Button className="mt-3" loading={create.isPending} disabled={f.title.trim().length < 2} onClick={() => create.mutate()}>Создать черновик</Button>
    </Section>}
    <Section title="Все конкурсы">
      {list.isLoading ? <Sk className="h-24" /> : !list.data?.items.length ? <Empty title="Конкурсов пока нет" text="Выберите быстрый пресет выше." /> : <div className="space-y-2">{list.data.items.map((c) => <div key={c.id}>
        <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-fg/10 p-3 text-left text-sm"><b>{c.title}</b><Badge tone={ST[c.status].tone}>{ST[c.status].t}</Badge><span className="text-muted">{c.prize} · участников {c.entries} · итоги {fmtDateTime(c.endsAt)}</span></button>
        {open === c.id && <div className="mt-2"><DetailCard id={c.id} canEdit={canEdit} /></div>}
      </div>)}</div>}
    </Section>
  </div>;
}

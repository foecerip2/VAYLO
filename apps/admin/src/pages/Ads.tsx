import { Badge, Button, Card, Field, Input, Select, Textarea, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Send } from 'lucide-react';
import { useState } from 'react';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, del, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface Ad { id: string; code: string; name: string; source: string; isActive: boolean; link: string; costRub: number; clicks: number; registrations: number; trials: number; paying: number; revenueRub: number; roiPct: number | null; cpaRub: number | null; cpRegRub: number | null }
interface Ads { items: Ad[]; totals: { costRub: number; revenueRub: number; registrations: number; paying: number; roiPct: number | null } }
interface Tpl { id: string; title: string; text: string; buttonText: string }
interface Post { id: string; kind: string; status: string; error: string; text: string; scheduledAt: string; sentAt: string | null }
const err = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const r0 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const PST: Record<string, { t: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = { sent: { t: 'Отправлен', tone: 'success' }, scheduled: { t: 'В очереди', tone: 'warning' }, failed: { t: 'Ошибка', tone: 'danger' }, cancelled: { t: 'Отменён', tone: 'neutral' } };
const localIn = (h: number) => new Date(Date.now() + h * 3600_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function AdsPage() {
  const { can } = useAuth(); const canEdit = can('admin');
  const qc = useQueryClient(); const toast = useToast();
  const ads = useQuery({ queryKey: ['ads'], queryFn: () => get<Ads>('/ads') });
  const tpls = useQuery({ queryKey: ['post-templates'], queryFn: () => get<Tpl[]>('/post-templates') });
  const posts = useQuery({ queryKey: ['channel-posts'], queryFn: () => get<{ channel: string; items: Post[] }>('/channel-posts'), refetchInterval: 30_000 });
  const [nf, setNf] = useState({ name: '', source: '', costRub: 0 });
  const addAd = useMutation({ mutationFn: () => post('/ads', nf), onSuccess: () => { setNf({ name: '', source: '', costRub: 0 }); void qc.invalidateQueries({ queryKey: ['ads'] }); toast('Ссылка создана', 'success'); }, onError: (e) => toast(err(e), 'error') });
  const [pf, setPf] = useState({ text: '', buttonText: '', imageUrl: '', adId: '', later: false, scheduleAt: localIn(3) });
  const send = useMutation({
    mutationFn: () => post<{ status: string; error: string }>('/channel-posts', { text: pf.text, buttonText: pf.buttonText, imageUrl: pf.imageUrl || undefined, adId: pf.adId || undefined, scheduleAt: pf.later ? new Date(pf.scheduleAt).toISOString() : undefined }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['channel-posts'] }); r.status === 'failed' ? toast(`Не отправлено: ${r.error}`, 'error') : toast(pf.later ? 'Пост запланирован' : 'Пост опубликован', 'success'); },
    onError: (e) => toast(err(e), 'error'),
  });
  const cancel = useMutation({ mutationFn: (id: string) => del(`/channel-posts/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['channel-posts'] }), onError: (e) => toast(err(e), 'error') });
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); toast('Ссылка скопирована', 'success'); };
  const t = ads.data?.totals;
  return <div className="space-y-5">
    <PageTitle title="Реклама и посты" subtitle="Отдельная ссылка на бота для каждого размещения: видно, сколько пришло, оплатило и окупилась ли реклама." />
    {t && <div className="grid gap-2 sm:grid-cols-4">{[['Затраты', `${r0(t.costRub)} ₽`], ['Выручка', `${r0(t.revenueRub)} ₽`], ['Регистраций', r0(t.registrations)], ['Окупаемость', t.roiPct === null ? '—' : `${t.roiPct}%`]].map(([k, v]) => <Card key={k} className="p-3"><div className="text-xs text-muted">{k}</div><div className="text-lg font-bold">{v}</div></Card>)}</div>}
    <Section title="Рекламные ссылки" description="Окупаемость = (выручка − затраты) / затраты. Выручка — успешные оплаты пришедших по ссылке; бонусы и промокоды не считаются.">
      {ads.isLoading ? <Sk className="h-24" /> : !ads.data?.items.length ? <Empty title="Ссылок пока нет" text="Создайте первую ниже." /> : <div className="space-y-2">{ads.data.items.map((a) => <Card key={a.id} className="space-y-1 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><b>{a.name}</b>{a.source && <Badge tone="neutral">{a.source}</Badge>}{!a.isActive && <Badge tone="warning">выключена</Badge>}<Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(a.link)}>Копировать</Button></div>
        <div className="text-xs text-muted">Регистраций {a.registrations} · пробный {a.trials} · оплатили {a.paying} · выручка {r0(a.revenueRub)} ₽ · затраты {r0(a.costRub)} ₽</div>
        <div className="text-xs">{a.roiPct === null ? <span className="text-muted">Укажите затраты, чтобы считать окупаемость</span> : <span className={a.roiPct >= 0 ? 'text-success' : 'text-danger'}>Окупаемость {a.roiPct}%{a.cpaRub !== null ? ` · цена платящего ${a.cpaRub} ₽` : ''}{a.cpRegRub !== null ? ` · цена регистрации ${a.cpRegRub} ₽` : ''}</span>}</div>
      </Card>)}</div>}
      {canEdit && <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto] sm:items-end">
        <Field label="Название"><Input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Блогер Вася" /></Field>
        <Field label="Источник"><Input value={nf.source} onChange={(e) => setNf({ ...nf, source: e.target.value })} placeholder="YouTube" /></Field>
        <Field label="Затраты, ₽"><Input type="number" min={0} value={nf.costRub} onChange={(e) => setNf({ ...nf, costRub: Number(e.target.value) })} /></Field>
        <Button loading={addAd.isPending} disabled={nf.name.trim().length < 2} onClick={() => addAd.mutate()}>Создать ссылку</Button>
      </div>}
    </Section>
    {canEdit && <Section title="Пост в канал" description={`Канал: ${posts.data?.channel || 'не указан (см. «Конкурсы» → Настройки)'}. {{link}} в тексте заменится ссылкой.`}>
      <div className="mb-3 flex flex-wrap gap-2">{tpls.data?.map((x) => <Button key={x.id} size="sm" variant="ghost" onClick={() => setPf({ ...pf, text: x.text, buttonText: x.buttonText })}>{x.title}</Button>)}</div>
      <Field label="Текст (поддерживается <b>, <i>)"><Textarea rows={6} value={pf.text} onChange={(e) => setPf({ ...pf, text: e.target.value })} /></Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Текст кнопки (пусто — без кнопки)"><Input value={pf.buttonText} maxLength={40} onChange={(e) => setPf({ ...pf, buttonText: e.target.value })} /></Field>
        <Field label="Рекламная ссылка для кнопки"><Select value={pf.adId} onChange={(e) => setPf({ ...pf, adId: e.target.value })}><option value="">Обычная ссылка на бота</option>{ads.data?.items.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Картинка (URL, необязательно)"><Input value={pf.imageUrl} onChange={(e) => setPf({ ...pf, imageUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pf.later} onChange={(e) => setPf({ ...pf, later: e.target.checked })} />Отложить</label>
        {pf.later && <Input type="datetime-local" className="w-56" value={pf.scheduleAt} onChange={(e) => setPf({ ...pf, scheduleAt: e.target.value })} />}
        <Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={pf.text.trim().length < 2} onClick={() => confirm(pf.later ? 'Запланировать пост?' : 'Опубликовать пост в канале сейчас?') && send.mutate()}>{pf.later ? 'Запланировать' : 'Опубликовать'}</Button>
      </div>
    </Section>}
    <Section title="Последние посты">
      {!posts.data?.items.length ? <Empty title="Постов пока нет" /> : <div className="space-y-2">{posts.data.items.map((p) => <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-fg/10 p-3 text-sm"><Badge tone={PST[p.status]?.tone ?? 'neutral'}>{PST[p.status]?.t ?? p.status}</Badge><span className="min-w-0 flex-1 truncate">{p.text.replace(/<[^>]+>/g, '')}</span><span className="text-xs text-muted">{fmtDateTime(p.sentAt ?? p.scheduledAt)}</span>{p.error && <span className="basis-full text-xs text-danger">{p.error}</span>}{p.status === 'scheduled' && canEdit && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)}>Отменить</Button>}</div>)}</div>}
    </Section>
  </div>;
}

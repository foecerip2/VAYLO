import { Badge, Button, Card, Field, Input, Select, Switch, Textarea, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Hourglass, UserMinus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageTitle, Section, Sk } from '../components/kit';
import { ApiError, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface PaidU { userId: string; tgId: string | null; username: string | null; firstName: string | null; expiresAt: string; paidUntil: string; effective: string }
interface Ov { active: boolean; endsAt: string | null; mode: 'auto' | 'manual'; announcedAt: string | null; reason: string; altText: string; altUrl: string; remindDays: number[]; farewell: boolean; lastPaid: PaidU | null; activeSubscribers: number; skipped: { userId: string; tgId: string | null; username: string | null; firstName: string | null }[]; sent: Record<string, number> }
const err = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const who = (u: { username: string | null; firstName: string | null; tgId: string | null }) => (u.username ? `@${u.username}` : u.firstName || `id ${u.tgId}`) + (u.tgId ? ` · ${u.tgId}` : '');
const localIn = (iso?: string | null, addH = 0) => { const d = new Date((iso ? new Date(iso).getTime() : Date.now()) + addH * 3600_000 - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
const STEP: Record<string, string> = { closure_announce: 'Объявление', closure_d14: 'Напоминание за 14 дн.', closure_d7: 'Напоминание за 7 дн.', closure_d3: 'Напоминание за 3 дн.', closure_d1: 'Напоминание за 1 дн.', closure_farewell: 'Прощание' };

function Live({ iso }: { iso: string }) {
  const [, t] = useState(0);
  useEffect(() => { const i = setInterval(() => t((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return <span className="font-mono text-2xl font-extrabold tabular-nums">{d} д {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}

export default function ClosurePage() {
  const { can } = useAuth(); const canEdit = can('admin');
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['closure'], queryFn: () => get<Ov>('/closure'), refetchInterval: 30_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['closure'] });
  const o = q.data;
  const [f, setF] = useState({ reason: '', altText: '', altUrl: '', mode: 'auto' as 'auto' | 'manual', endsAt: localIn(null, 24 * 14), channelPost: true, farewell: true });
  const [seeded, setSeeded] = useState(false);
  useEffect(() => { if (o && !seeded) { setF((p) => ({ ...p, reason: o.reason, altText: o.altText, altUrl: o.altUrl, farewell: o.farewell })); setSeeded(true); } }, [o, seeded]);
  const [edit, setEdit] = useState<string>('');
  useEffect(() => { if (o?.endsAt) setEdit(localIn(o.endsAt)); }, [o?.endsAt]);
  const [typed, setTyped] = useState('');
  const [notify, setNotify] = useState(true);

  const announce = useMutation({
    mutationFn: () => post<{ endsAt: string; postStatus: string; postError: string }>('/closure/announce', { reason: f.reason, altText: f.altText, altUrl: f.altUrl, mode: f.mode, endsAt: f.mode === 'manual' ? new Date(f.endsAt).toISOString() : undefined, channelPost: f.channelPost, farewell: f.farewell }),
    onSuccess: (r) => { refresh(); setTyped(''); r.postStatus === 'failed' ? toast(`Закрытие объявлено, но пост в канал не ушёл: ${r.postError}`, 'error') : toast('Закрытие объявлено. Рассылка идёт в фоне.', 'success'); },
    onError: (e) => toast(err(e), 'error'),
  });
  const change = useMutation({ mutationFn: (b: Record<string, unknown>) => put<Ov>('/closure', b), onSuccess: () => { refresh(); toast('Сохранено', 'success'); }, onError: (e) => toast(err(e), 'error') });
  const cancel = useMutation({ mutationFn: () => post<{ notified: number }>('/closure/cancel', { notify }), onSuccess: (r) => { refresh(); toast(`Закрытие отменено${notify ? `, уведомление уйдёт ${r.notified} пользователям` : ''}`, 'success'); }, onError: (e) => toast(err(e), 'error') });
  const csv = useMutation({
    mutationFn: () => get<string>('/closure/refunds.csv'),
    onSuccess: (text) => { const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'refunds.csv'; a.click(); URL.revokeObjectURL(url); },
    onError: (e) => toast(err(e), 'error'),
  });

  const LastPaid = () => !o?.lastPaid ? <p className="text-sm text-danger">Не найдено ни одной действующей подписки, оплаченной через ЮKassa. Для запуска укажите дату вручную.</p> : (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2"><UserMinus className="h-4 w-4 text-primary" /><b>{who(o.lastPaid)}</b></div>
      <div className="text-xs text-muted">Оплаченный срок до {fmtDateTime(o.lastPaid.paidUntil)} · подписка до {fmtDateTime(o.lastPaid.expiresAt)}. Дни, выданные вручную, подарки и бонусы не учитываются.</div>
      <div className="text-xs">Дата закрытия по нему: <b>{fmtDateTime(o.lastPaid.effective)}</b></div>
      {canEdit && <Button size="sm" variant="ghost" loading={change.isPending} onClick={() => confirm(`Пропустить ${who(o.lastPaid!)}? Таймер переедет на следующего оплатившего.`) && change.mutate({ skipAdd: o.lastPaid!.userId })}>Пропустить этого пользователя</Button>}
    </div>);

  if (q.isLoading || !o) return <div className="space-y-3"><PageTitle title="Закрытие проекта" /><Sk className="h-48" /></div>;
  return <div className="space-y-5">
    <PageTitle title="Закрытие проекта" subtitle="Оповещение пользователей, таймер в боте и Mini App, закрытие продаж и регистрации. Действующие подписки не отключаются." />
    {o.active ? <>
      <Card className="space-y-3 border-warning/40 bg-warning/10 p-4">
        <div className="flex items-center gap-2 font-bold"><Hourglass className="h-5 w-5 text-warning" />Закрытие объявлено <Badge tone="warning">{o.mode === 'auto' ? 'дата по последнему платящему' : 'дата вручную'}</Badge></div>
        {o.endsAt && <div><Live iso={o.endsAt} /><div className="text-xs text-muted">до {fmtDateTime(o.endsAt)}</div></div>}
        <p className="text-xs text-muted">Продажи, пополнения, пробный период, промокоды, колесо, задания и регистрация закрыты. Автопродление отключено.</p>
      </Card>
      <Section title="Дата закрытия" description="Меняйте вручную или вернитесь к автоматическому расчёту по последнему оплатившему через ЮKassa.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Своя дата (ваше время)"><Input type="datetime-local" value={edit} onChange={(e) => setEdit(e.target.value)} /></Field>
          {canEdit && <Button loading={change.isPending} disabled={!edit} onClick={() => change.mutate({ mode: 'manual', endsAt: new Date(edit).toISOString() })}>Сохранить дату</Button>}
          {canEdit && o.mode === 'manual' && <Button variant="ghost" loading={change.isPending} onClick={() => change.mutate({ mode: 'auto' })}>Вернуть автоматический расчёт</Button>}
        </div>
      </Section>
      <Section title="Последний оплативший через ЮKassa"><LastPaid /></Section>
    </> : <>
      <Section title="Когда проект закроется" description={`Действующих подписок сейчас: ${o.activeSubscribers}.`}>
        <Field label="Как определить дату"><Select value={f.mode} disabled={!canEdit} onChange={(e) => setF({ ...f, mode: e.target.value as 'auto' | 'manual' })}><option value="auto">По последнему оплатившему через ЮKassa (рекомендуется)</option><option value="manual">Задам дату сам</option></Select></Field>
        {f.mode === 'manual' ? <Field label="Дата и время (ваше время)"><Input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field> : <div className="mt-3 rounded-2xl border border-fg/10 p-3"><LastPaid /></div>}
      </Section>
    </>}
    {o.skipped.length > 0 && <Section title="Пропущенные пользователи" description="Не учитываются при поиске последнего оплатившего.">
      <div className="space-y-2">{o.skipped.map((u) => <div key={u.userId} className="flex items-center justify-between rounded-2xl border border-fg/10 p-3 text-sm"><span>{who(u)}</span>{canEdit && <Button size="sm" variant="ghost" onClick={() => change.mutate({ skipRemove: u.userId })}>Вернуть в расчёт</Button>}</div>)}</div>
    </Section>}
    {!o.active && canEdit && <Section title="Текст оповещения">
      <Field label="Причина (увидят пользователи)"><Textarea rows={8} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Куда перейти (необязательно)"><Textarea rows={2} value={f.altText} onChange={(e) => setF({ ...f, altText: e.target.value })} placeholder="Рекомендуем сервис…" /></Field>
        <Field label="Ссылка (необязательно)"><Input value={f.altUrl} onChange={(e) => setF({ ...f, altUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-center gap-2"><Switch checked={f.channelPost} onChange={(v) => setF({ ...f, channelPost: v })} label="Пост в канал" />Опубликовать пост в канале</label>
        <label className="flex items-center gap-2"><Switch checked={f.farewell} onChange={(v) => setF({ ...f, farewell: v })} label="Прощание" />Отправить прощальное сообщение в день закрытия</label>
        <p className="text-xs text-muted">Напоминания владельцам подписки уйдут за 14, 7, 3 и 1 день до закрытия.</p>
      </div>
      <Card className="mt-4 space-y-3 border-danger/40 p-4">
        <div className="flex items-center gap-2 font-bold text-danger"><AlertTriangle className="h-5 w-5" />Это сразу закроет продажи и регистрацию</div>
        <p className="text-sm text-muted">Сразу после запуска: покупки и пополнения закрыты, новые пользователи не регистрируются, автопродление отключается, всем в боте уйдёт оповещение. Отменить можно в любой момент.</p>
        <Field label="Для подтверждения введите слово «закрыть»"><Input value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
        <Button variant="danger" loading={announce.isPending} disabled={typed.trim().toLowerCase() !== 'закрыть' || f.reason.trim().length < 10 || (f.mode === 'auto' && !o.lastPaid)} onClick={() => announce.mutate()}>Объявить о закрытии проекта</Button>
      </Card>
    </Section>}
    {o.active && <>
      <Section title="Что отправлено">
        {Object.keys(o.sent).length === 0 ? <p className="text-sm text-muted">Рассылка начнётся в течение минуты.</p> : <div className="space-y-1 text-sm">{Object.entries(o.sent).map(([k, v]) => <div key={k} className="flex justify-between rounded-xl border border-fg/10 px-3 py-2"><span>{STEP[k] ?? k}</span><b>{v}</b></div>)}</div>}
      </Section>
      <Section title="Возвраты" description="Выгрузка оплат ЮKassa с неиспользованным остатком: пропорционально оставшимся дням. Это ориентир для ручных возвратов, а не готовые суммы.">
        <Button variant="ghost" icon={<Download className="h-4 w-4" />} loading={csv.isPending} onClick={() => csv.mutate()}>Скачать список (CSV)</Button>
      </Section>
      {canEdit && <Section title="Отменить закрытие">
        <label className="mb-3 flex items-center gap-2 text-sm"><Switch checked={notify} onChange={setNotify} label="Сообщить пользователям" />Сообщить пользователям, что закрытие отменено</label>
        <Button variant="ghost" loading={cancel.isPending} onClick={() => confirm('Отменить закрытие? Продажи и регистрация откроются снова.') && cancel.mutate()}>Отменить закрытие</Button>
      </Section>}
    </>}
  </div>;
}

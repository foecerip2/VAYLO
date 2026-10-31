import { Badge, Button, Card, Field, Input, Select, Switch, useToast, cn } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Server, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

type Group = 'location' | 'bridge' | 'lte';
interface Srv { id: string; nodeUuid: string; title: string; group: Group; sort: number; visible: boolean; planIds: string[]; status: 'up' | 'down' | 'unknown'; since: string | null }
interface Settings { enabled: boolean; notify_users: boolean; notify_audience: 'all' | 'active'; notify_after_minutes: number; notify_recovery: boolean; compensate: boolean; compensate_after_hours: number; compensate_days: number; lte_note: string }
interface Data {
  settings: Settings;
  servers: Srv[];
  plans: { id: string; name: string }[];
  outages: { id: string; title: string; startedAt: string; resolvedAt: string | null; notifiedCount: number; compensated: boolean; compDays: number; compUsers: number; compFailed: number; compDone: boolean }[];
  preview: { overall: string; summary: string };
}
const GROUPS: Record<Group, string> = { location: 'Локация', bridge: 'Мост (вход из РФ)', lte: 'LTE для белых списков' };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const dur = (a: string, b: string | null) => { const m = Math.max(0, Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };

function Row({ s, plans, canEdit, onSaved }: { s: Srv; plans: Data['plans']; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const dirty = JSON.stringify({ ...f, status: 0, since: 0 }) !== JSON.stringify({ ...s, status: 0, since: 0 });
  const save = useMutation({ mutationFn: () => put(`/status-servers/${s.id}`, { title: f.title.trim(), group: f.group, sort: f.sort, visible: f.visible, planIds: f.planIds }), onSuccess: () => { onSaved(); toast('Сохранено', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const remove = useMutation({ mutationFn: () => del(`/status-servers/${s.id}`), onSuccess: () => { onSaved(); toast('Удалено из списка', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  return (
    <div className="space-y-3 rounded-2xl border border-fg/10 p-3">
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', s.status === 'up' ? 'bg-success' : s.status === 'down' ? 'bg-danger' : 'bg-muted')} aria-label={s.status} />
        <span className="text-xs text-muted">{s.status === 'up' ? 'Работает' : s.status === 'down' ? `Недоступен с ${fmtDateTime(s.since)}` : 'Нет данных'}</span>
        <label className="ml-auto flex items-center gap-2 text-xs"><Switch checked={f.visible} onChange={(v) => setF({ ...f, visible: v })} label="Показывать" disabled={!canEdit} />Показывать</label>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_190px_90px]">
        <Field label="Название (как видят пользователи)"><Input value={f.title} maxLength={80} disabled={!canEdit} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="🇸🇪 Швеция" /></Field>
        <Field label="Раздел"><Select value={f.group} disabled={!canEdit} onChange={(e) => setF({ ...f, group: e.target.value as Group })}>{(Object.keys(GROUPS) as Group[]).map((g) => <option key={g} value={g}>{GROUPS[g]}</option>)}</Select></Field>
        <Field label="Порядок"><Input type="number" min={0} value={f.sort} disabled={!canEdit} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} /></Field>
      </div>
      {plans.length > 0 && (
        <Field label="Только для тарифов" hint="Не выбрано — касается всех. Выберите тарифы (например, PURPLE), и оповещения и компенсация по этому серверу получат только их владельцы.">
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => { const on = f.planIds.includes(p.id); return <button type="button" key={p.id} disabled={!canEdit} onClick={() => setF({ ...f, planIds: on ? f.planIds.filter((x) => x !== p.id) : [...f.planIds, p.id] })} className={cn('rounded-full border px-3 py-1.5 text-sm', on ? 'border-primary bg-primary/15' : 'border-fg/10')}>{p.name}</button>; })}
          </div>
        </Field>
      )}
      {canEdit && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!dirty || !f.title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
          <Button size="sm" variant="ghost" className="ml-auto" aria-label="Убрать из списка" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={() => confirm(`Убрать «${s.title}» из списка статуса? Нода в Remnawave не удаляется; при следующей синхронизации она появится снова.`) && remove.mutate()} />
        </div>
      )}
    </div>
  );
}

export default function StatusServersPage() {
  const { can } = useAuth();
  const canEdit = can('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['status-servers'], queryFn: () => get<Data>('/status-servers'), refetchInterval: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['status-servers'] });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (q.data && !s) setS(q.data.settings); }, [q.data, s]);
  const sync = useMutation({ mutationFn: () => post<{ added: number }>('/status-servers/sync'), onSuccess: (r) => { void refresh(); toast(r.added ? `Добавлено серверов: ${r.added}` : 'Новых нод нет', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const save = useMutation({ mutationFn: (v: Settings) => put('/status-servers/settings', v), onSuccess: () => { void refresh(); toast('Сохранено', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const d = q.data;

  return (
    <div className="animate-fade-up space-y-4">
      <PageTitle title="Статус серверов" subtitle="Что видят пользователи в боте, оповещения о простоях и компенсация днями" actions={canEdit && <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>Подтянуть ноды</Button>} />
      {q.isLoading || !d || !s ? (
        <div className="space-y-3"><Sk className="h-24" /><Sk className="h-64" /></div>
      ) : (
        <>
          <Card className="p-4 text-sm"><span className="text-muted">Сейчас пользователи видят: </span><b>{d.preview.summary}</b></Card>

          <Section title="Серверы" description="Ноды берутся из Remnawave. Переименуйте их как нужно, разложите по разделам и отметьте тарифы для LTE. Скрытые серверы пользователям не показываются и не вызывают оповещений.">
            {!d.servers.length ? (
              <Empty icon={<Server className="h-6 w-6" />} title="Список пока пуст" text="Нажмите «Подтянуть ноды», чтобы загрузить серверы из Remnawave." />
            ) : (
              <div className="space-y-3">{d.servers.map((x) => <Row key={x.id} s={x} plans={d.plans} canEdit={canEdit} onSaved={refresh} />)}</div>
            )}
          </Section>

          <Section title="Оповещения и компенсация" right={<Badge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'Включено' : 'Выключено'}</Badge>}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-3 text-sm md:col-span-2"><Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Включено" />Отслеживать простои серверов</label>
              <label className="flex items-center gap-3 text-sm"><Switch checked={s.notify_users} onChange={(v) => setS({ ...s, notify_users: v })} label="Оповещать" />Рассылать «сервер недоступен, ведутся работы»</label>
              <label className="flex items-center gap-3 text-sm"><Switch checked={s.notify_recovery} onChange={(v) => setS({ ...s, notify_recovery: v })} label="О восстановлении" />Писать, когда сервер снова работает</label>
              <Field label="Кому рассылать"><Select value={s.notify_audience} onChange={(e) => setS({ ...s, notify_audience: e.target.value as 'all' | 'active' })}><option value="all">Всем пользователям бота</option><option value="active">Только с действующей подпиской</option></Select></Field>
              <Field label="Через сколько минут простоя рассылать" hint="Защита от кратковременных «морганий»"><Input type="number" min={1} max={120} value={s.notify_after_minutes} onChange={(e) => setS({ ...s, notify_after_minutes: Number(e.target.value) })} /></Field>
              <label className="flex items-center gap-3 text-sm md:col-span-2"><Switch checked={s.compensate} onChange={(v) => setS({ ...s, compensate: v })} label="Компенсация" />Автоматически продлевать подписки при долгом простое</label>
              <Field label="Простой дольше, часов"><Input type="number" min={1} max={72} value={s.compensate_after_hours} onChange={(e) => setS({ ...s, compensate_after_hours: Number(e.target.value) })} /></Field>
              <Field label="Начислить, дней" hint="Только пользователям с действующей подпиской; не чаще раза в сутки"><Input type="number" min={1} max={30} value={s.compensate_days} onChange={(e) => setS({ ...s, compensate_days: Number(e.target.value) })} /></Field>
              <Field label="Подпись раздела LTE" hint="Например: LTE для белых списков (только в тарифе 🟣PURPLE)"><Input value={s.lte_note} maxLength={160} onChange={(e) => setS({ ...s, lte_note: e.target.value })} /></Field>
            </div>
            {canEdit && <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate(s)}>Сохранить</Button>}
          </Section>

          <Section title="История простоев">
            {!d.outages.length ? (
              <Empty icon={<Server className="h-6 w-6" />} title="Простоев не было" text="Здесь появятся случаи, когда сервер был недоступен, и что за них сделано." />
            ) : (
              <div className="space-y-2">
                {d.outages.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-fg/10 p-3 text-sm">
                    <b className="min-w-0 flex-1 break-words">{o.title}</b>
                    <Badge tone={o.resolvedAt ? 'success' : 'warning'}>{o.resolvedAt ? 'Восстановлен' : 'Идёт'}</Badge>
                    <span className="text-muted">{fmtDateTime(o.startedAt)} · {dur(o.startedAt, o.resolvedAt)}</span>
                    <span className="text-xs text-muted">оповещено: {o.notifiedCount}{o.compensated ? ` · продлено: ${o.compUsers} (+${o.compDays} дн.)${o.compFailed ? `, ошибок ${o.compFailed}` : ''}${o.compDone ? '' : ' · идёт…'}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

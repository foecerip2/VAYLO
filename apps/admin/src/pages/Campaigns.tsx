import { Badge, Button, Card, Field, Input, Select, Sheet, Switch, Textarea, useToast, cn } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Coins, Gift, Percent, Plus, Send, Trash2, WalletCards } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { PageTitle } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, rub } from '../lib/format';
import type { PlanDTO } from '@vpn/shared';

type Kind = 'days' | 'balance' | 'plan_discount' | 'topup_bonus';
interface Campaign {
  id: string; title: string; kind: Kind; value: number; audience: string; planIds: string[] | null; message: string; notify: boolean; isActive: boolean;
  startsAt: string; endsAt: string | null; status: 'draft' | 'running' | 'done'; total: number; granted: number; failed: number; startedAt: string | null; finishedAt: string | null; createdAt: string;
}
const KINDS: Record<Kind, { title: string; hint: string; icon: ComponentType<{ className?: string }>; unit: string; grant: boolean }> = {
  days: { title: 'Компенсация днями', hint: 'Разово добавить дни к подписке выбранным пользователям — например, за сбой', icon: CalendarClock, unit: 'дн.', grant: true },
  balance: { title: 'Компенсация на баланс', hint: 'Разово зачислить рубли на баланс', icon: Coins, unit: '₽', grant: true },
  plan_discount: { title: 'Скидка на тарифы', hint: 'Автоматическая скидка при покупке тарифа, пока акция действует', icon: Percent, unit: '%', grant: false },
  topup_bonus: { title: 'Бонус к пополнению', hint: 'Дополнительные % на баланс при каждом пополнении, пока акция действует', icon: WalletCards, unit: '%', grant: false },
};
const AUD_FALLBACK: Record<string, string> = { all: 'Все пользователи' };
const valueText = (c: Campaign) => (c.kind === 'days' ? `+${c.value} дн.` : c.kind === 'balance' ? `+${rub(c.value)}` : c.kind === 'plan_discount' ? `−${c.value}%` : `+${c.value}% к пополнению`);
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const live = (c: Campaign) => c.isActive && new Date(c.startsAt).getTime() <= Date.now() && (!c.endsAt || new Date(c.endsAt).getTime() > Date.now());

export default function CampaignsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = can('admin');
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => get<{ audiences: Record<string, string>; items: Campaign[] }>('/campaigns'), refetchInterval: (query) => (query.state.data?.items.some((c) => c.status === 'running') ? 2500 : false) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get<PlanDTO[]>('/plans'), enabled: canEdit });
  const audiences = q.data?.audiences ?? AUD_FALLBACK;
  const refresh = () => qc.invalidateQueries({ queryKey: ['campaigns'] });

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'days' as Kind, title: '', value: '3', audience: 'active', message: '', notify: true, endsAt: '', planIds: [] as string[] });
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !KINDS[f.kind].grant) { setCount(null); return; }
    let off = false;
    get<{ count: number }>(`/campaigns/audience?audience=${f.audience}`).then((r) => !off && setCount(r.count)).catch(() => !off && setCount(null));
    return () => { off = true; };
  }, [open, f.kind, f.audience]);

  const n = Number(f.value.replace(',', '.'));
  const value = f.kind === 'balance' ? Math.round(n * 100) : Math.round(n);
  const valid = f.title.trim().length >= 2 && value > 0 && (f.kind === 'days' || f.kind === 'balance' || value <= 100);

  const create = useMutation({
    mutationFn: () => post<Campaign>('/campaigns', { title: f.title.trim(), kind: f.kind, value, audience: f.audience, message: f.message.trim(), notify: f.notify, planIds: f.kind === 'plan_discount' && f.planIds.length ? f.planIds : null, endsAt: f.endsAt ? new Date(f.endsAt + 'T23:59:59').toISOString() : null }),
    onSuccess: (c) => { void refresh(); setOpen(false); toast(KINDS[c.kind].grant ? 'Черновик создан — проверьте и нажмите «Выдать»' : 'Акция запущена', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const start = useMutation({ mutationFn: (id: string) => post(`/campaigns/${id}/start`), onSuccess: () => { void refresh(); toast('Выдача запущена', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const toggle = useMutation({ mutationFn: (c: Campaign) => put(`/campaigns/${c.id}`, { isActive: !c.isActive }), onSuccess: () => void refresh(), onError: (e) => toast(errMsg(e), 'error') });
  const remove = useMutation({ mutationFn: (id: string) => del(`/campaigns/${id}`), onSuccess: () => { void refresh(); toast('Удалено', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });

  const confirmStart = (c: Campaign) => {
    const who = audiences[c.audience] ?? c.audience;
    if (confirm(`Выдать «${c.title}» (${valueText(c)}) аудитории «${who}»?\n\nЭто действие нельзя отменить.`)) start.mutate(c.id);
  };
  const items = q.data?.items ?? [];

  return (
    <div className="animate-fade-up">
      <PageTitle title="Акции" subtitle="Компенсации всем, скидки на тарифы и бонусы к пополнению" actions={canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setF({ kind: 'days', title: '', value: '3', audience: 'active', message: '', notify: true, endsAt: '', planIds: [] }); setOpen(true); }}>Создать</Button>} />
      {q.isLoading && <div className="text-sm text-muted">Загрузка…</div>}
      {!q.isLoading && items.length === 0 && (
        <Card className="p-6 text-center">
          <Gift className="mx-auto mb-2 h-8 w-8 text-primary" />
          <div className="font-semibold">Акций пока нет</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Например: «+3 дня всем за сбой», «−20% на тарифы до воскресенья» или «+10% к пополнению на выходных».</p>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((c) => {
          const K = KINDS[c.kind]; const Icon = K.icon;
          const auto = !K.grant;
          const on = auto && live(c);
          const expired = auto && c.endsAt && new Date(c.endsAt).getTime() <= Date.now();
          return (
            <Card key={c.id} className="min-w-0 space-y-3 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary"><Icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="break-words font-semibold leading-tight">{c.title}</div>
                  <div className="text-xs text-muted">{K.title} · {audiences[c.audience] ?? c.audience}</div>
                </div>
                <div className="shrink-0 text-right text-lg font-extrabold text-primary">{valueText(c).split(' к ')[0]}</div>
              </div>
              {auto ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <Badge tone={on ? 'success' : expired ? 'neutral' : 'warning'}>{on ? 'Действует' : expired ? 'Завершена' : !c.isActive ? 'Выключена' : 'Ещё не началась'}</Badge>
                  <span>{c.endsAt ? `до ${fmtDateTime(c.endsAt)}` : 'без срока'}</span>
                  {c.planIds?.length ? <span>только выбранные тарифы ({c.planIds.length})</span> : c.kind === 'plan_discount' ? <span>все тарифы</span> : null}
                </div>
              ) : (
                <div className="space-y-1.5 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <Badge tone={c.status === 'done' ? 'success' : c.status === 'running' ? 'primary' : 'warning'}>{c.status === 'done' ? 'Выдано' : c.status === 'running' ? 'Выдаётся…' : 'Черновик'}</Badge>
                    {c.status !== 'draft' && <span>{c.granted} из {c.total}{c.failed ? ` · ошибок: ${c.failed}` : ''}</span>}
                    {c.finishedAt && <span>{fmtDateTime(c.finishedAt)}</span>}
                  </div>
                  {c.status === 'running' && <div className="h-1.5 overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-2 transition-all" style={{ width: `${c.total ? Math.min(100, ((c.granted + c.failed) / c.total) * 100) : 5}%` }} /></div>}
                </div>
              )}
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  {K.grant && c.status !== 'done' && <Button size="sm" loading={start.isPending && start.variables === c.id} disabled={c.status === 'running'} icon={<Send className="h-3.5 w-3.5" />} onClick={() => confirmStart(c)}>{c.status === 'running' ? 'Идёт выдача' : 'Выдать'}</Button>}
                  {auto && !expired && <span className="flex items-center gap-2 text-sm"><Switch checked={c.isActive} onChange={() => toggle.mutate(c)} label="Включена" />{c.isActive ? 'Включена' : 'Выключена'}</span>}
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label="Удалить" disabled={c.status === 'running'} icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={() => confirm(`Удалить «${c.title}»?${K.grant && c.status === 'done' ? '\nВыданное не откатится.' : ''}`) && remove.mutate(c.id)} />
                </div>
              )}
              <div className="text-[11px] text-muted/70">Создана {fmtDate(c.createdAt)}</div>
            </Card>
          );
        })}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Новая акция">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
          <div className="grid gap-2">
            {(Object.keys(KINDS) as Kind[]).map((k) => {
              const I = KINDS[k].icon;
              return (
                <button type="button" key={k} onClick={() => setF({ ...f, kind: k, value: k === 'days' ? '3' : k === 'balance' ? '50' : '20', audience: KINDS[k].grant ? (f.audience === 'all' ? 'all' : 'active') : 'all' })} className={cn('flex items-start gap-3 rounded-2xl border p-3 text-left transition', f.kind === k ? 'border-primary bg-primary/10' : 'border-fg/10 bg-fg/[.03]')}>
                  <I className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="min-w-0"><b className="block text-sm">{KINDS[k].title}</b><span className="block text-xs text-muted">{KINDS[k].hint}</span></span>
                </button>
              );
            })}
          </div>
          <Field label="Название" hint="Видно пользователям в баннере и уведомлении"><Input value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'days' ? 'Извинения за сбой 20 октября' : f.kind === 'plan_discount' ? 'Осенняя распродажа' : 'Выходные с бонусом'} required /></Field>
          <Field label={f.kind === 'days' ? 'Сколько дней' : f.kind === 'balance' ? 'Сумма, ₽' : 'Процент'}>
            <Input type="number" inputMode="decimal" min={f.kind === 'balance' ? 1 : 1} step={f.kind === 'balance' ? 0.01 : 1} max={f.kind === 'plan_discount' ? 100 : undefined} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </Field>
          <Field label="Кому" hint={KINDS[f.kind].grant && count !== null ? `Получат: ${count} чел.` : undefined}>
            <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{Object.entries(audiences).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          {f.kind === 'days' && f.audience === 'no_sub' && <p className="rounded-xl bg-warning/10 p-3 text-xs text-warning">Пользователи без подписки получат бесплатный доступ на эти дни — уверены?</p>}
          {f.kind === 'plan_discount' && plans.data && plans.data.length > 0 && (
            <Field label="Тарифы" hint="Ничего не выбрано — скидка на все тарифы">
              <div className="flex flex-wrap gap-2">
                {plans.data.map((p) => { const on = f.planIds.includes(p.id); return <button type="button" key={p.id} onClick={() => setF({ ...f, planIds: on ? f.planIds.filter((x) => x !== p.id) : [...f.planIds, p.id] })} className={cn('rounded-full border px-3 py-1.5 text-sm', on ? 'border-primary bg-primary/15' : 'border-fg/10')}>{p.name}</button>; })}
              </div>
            </Field>
          )}
          {!KINDS[f.kind].grant && <Field label="Действует до" hint="Пусто — пока не выключите. Включается сразу."><Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>}
          {KINDS[f.kind].grant && (
            <>
              <div className="flex items-center gap-3 text-sm"><Switch checked={f.notify} onChange={(v) => setF({ ...f, notify: v })} label="Сообщить в боте" /><span>Сообщить пользователям в боте</span></div>
              {f.notify && <Field label="Текст уведомления" hint="Пусто — отправим стандартное «Подарок от VAYLO»"><Textarea value={f.message} maxLength={900} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="🎁 Вчера был сбой — мы добавили вам +3 дня. Извините!" /></Field>}
            </>
          )}
          <Button type="submit" full loading={create.isPending} disabled={!valid}>{KINDS[f.kind].grant ? 'Создать черновик' : 'Запустить акцию'}</Button>
          {KINDS[f.kind].grant && <p className="text-center text-xs text-muted">Выдача начнётся только после кнопки «Выдать» в списке.</p>}
        </form>
      </Sheet>
    </div>
  );
}

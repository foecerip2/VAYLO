import { Badge, Button, Card, CopyField, ErrorState, Field, Input, ProgressBar, Sheet, Skeleton, cn, useToast } from '@vpn/ui';
import { formatRub, pluralDays, type WithdrawalDTO } from '@vpn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowRightLeft, Award, CalendarPlus, ChevronRight, GitBranch, Link2, Share2, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { useConfig, useReferrals } from '../lib/queries';
import { errorText, get, post } from '../lib/api';
import { haptic, openExternal } from '../lib/tg';

const share = (link: string) => openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Быстрый и надёжный VPN — попробуй:')}`);

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-btn bg-surface-2 p-3 text-center"><div className="num text-lg font-bold">{value}</div><div className="text-[11px] text-muted">{label}</div></div>
);

type Stats = NonNullable<ReturnType<typeof useReferrals>['data']>;
const statusLbl: Record<WithdrawalDTO['status'], { t: string; tone: 'warning' | 'success' | 'danger' }> = { pending: { t: 'В обработке', tone: 'warning' }, paid: { t: 'Выплачено', tone: 'success' }, rejected: { t: 'Отклонено', tone: 'danger' } };

function ModePicker({ d }: { d: Stats }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const mode = useMutation({
    mutationFn: (m: 'days' | 'balance') => post('/referrals/mode', { mode: m }),
    onSuccess: () => { haptic('success'); void qc.invalidateQueries({ queryKey: ['referrals'] }); },
    onError: (e) => { haptic('error'); toast(errorText(e), 'error'); },
  });
  const move = useMutation({
    mutationFn: () => post<{ moved: number; bonus: number }>('/referrals/transfer', {}),
    onSuccess: (r) => { haptic('success'); toast(`На баланс зачислено ${formatRub(r.moved + r.bonus)}${r.bonus ? ` (с бонусом ${formatRub(r.bonus)})` : ''}`, 'success'); void qc.invalidateQueries({ queryKey: ['referrals'] }); void qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const ws = useQuery({ queryKey: ['withdrawals'], queryFn: () => get<WithdrawalDTO[]>('/referrals/withdrawals'), enabled: d.mode !== 'days' || d.refBalance > 0 || d.withdrawPending > 0 || d.withdrawn > 0 });
  const w = d.withdraw;
  const pct = d.rewardPercent + (d.rank?.percent ?? 0);
  const days = d.rewardDays + (d.rank?.extraDays ?? 0);
  const both = d.mode === 'both';
  const opts: { key: 'days' | 'balance'; icon: React.ReactNode; title: string; big: string; text: string }[] = [
    { key: 'days', icon: <CalendarPlus className="h-5 w-5" />, title: 'Бесплатные дни', big: `+${days} ${pluralDays(days)}`, text: `за каждого друга, который оплатил подписку${d.level2Days ? ` + ${d.level2Days} ${pluralDays(d.level2Days)} за его друзей` : ''}` },
    { key: 'balance', icon: <Wallet className="h-5 w-5" />, title: 'Деньги', big: `${pct}% с оплат`, text: `${d.recurring ? 'с каждой оплаты' : 'с первой оплаты'} друга${d.level2Percent ? ` + ${d.level2Percent}% с его друзей` : ''}. Можно вывести` },
  ];
  return (
    <>
      <div className="hero-bg relative overflow-hidden rounded-[24px] p-5 text-white shadow-glow">
        <div className="blob pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/15 blur-2xl" />
        <div className="relative text-sm text-white/85">{both ? 'Вы получаете' : 'Выберите, что вам выгоднее'}</div>
        {both ? <div className="relative mt-1 text-2xl font-bold leading-tight">{[days ? `+${days} ${pluralDays(days)}` : '', pct ? `${pct}% на баланс` : ''].filter(Boolean).join(' и ') || 'Бонусы за друзей'}</div> : (
          <div className="relative mt-3 grid grid-cols-2 gap-2.5">
            {opts.map((o) => {
              const on = d.mode === o.key;
              return (
                <button key={o.key} type="button" disabled={mode.isPending} onClick={() => !on && mode.mutate(o.key)} aria-pressed={on}
                  className={cn('rounded-2xl p-3 text-left transition active:scale-[.98]', on ? 'bg-white text-slate-900 shadow-lg ring-2 ring-white' : 'bg-white/15 text-white ring-1 ring-white/30')}>
                  <div className="flex items-center justify-between">{o.icon}{on && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">ВЫБРАНО</span>}</div>
                  <div className="mt-2 text-[13px] font-semibold opacity-80">{o.title}</div>
                  <div className="text-lg font-extrabold leading-tight">{o.big}</div>
                  <div className={cn('mt-1 text-[11px] leading-snug', on ? 'text-slate-600' : 'text-white/80')}>{o.text}</div>
                </button>
              );
            })}
          </div>
        )}
        {d.signupBonus > 0 && <div className="relative mt-3 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">Друг получит приветственный бонус {formatRub(d.signupBonus)}</div>}
        {!both && <div className="relative mt-3 text-xs text-white/75">Режим можно менять в любой момент — он применяется к новым оплатам друзей.</div>}
      </div>

      {!both && (d.mode === 'balance' || d.refBalance > 0 || d.withdrawPending > 0 || d.withdrawn > 0) && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 font-semibold"><Wallet className="h-5 w-5 text-success" /> Реферальный счёт</div>
          <div className="flex items-end justify-between">
            <div className="min-w-0"><div className="num text-3xl font-extrabold">{formatRub(d.refBalance)}</div><div className="text-xs text-muted">доступно к выводу</div></div>
            {(d.withdrawPending > 0 || d.withdrawn > 0) && <div className="shrink-0 whitespace-nowrap text-right text-xs text-muted">{d.withdrawPending > 0 && <div>в обработке: <b className="text-fg">{formatRub(d.withdrawPending)}</b></div>}{d.withdrawn > 0 && <div>выплачено: <b className="text-fg">{formatRub(d.withdrawn)}</b></div>}</div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} disabled={d.refBalance <= 0} loading={move.isPending} onClick={() => move.mutate()}><span className="whitespace-nowrap text-[13px]">На баланс{w.transferBonusPercent ? ` +${w.transferBonusPercent}%` : ""}</span></Button>
            <Button icon={<Wallet className="h-4 w-4" />} disabled={!w.enabled || d.refBalance < w.min} onClick={() => setOpen(true)}>Вывести</Button>
          </div>
          <p className="text-xs text-muted">{w.enabled ? `Вывод от ${formatRub(w.min)}${w.feePercent ? `, комиссия ${w.feePercent}%` : ''}. ` : 'Вывод временно недоступен. '}{w.transferBonusPercent ? `При переводе на баланс для оплаты подписки добавляем +${w.transferBonusPercent}%.` : ''}</p>
          {!!ws.data?.length && (
            <ul className="space-y-1.5 border-t border-border pt-3">
              {ws.data.slice(0, 5).map((x) => (
                <li key={x.id} className="flex items-center justify-between text-sm"><span className="text-muted">{new Date(x.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · {formatRub(x.payout)}</span><Badge tone={statusLbl[x.status].tone}>{statusLbl[x.status].t}</Badge></li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {open && <WithdrawSheet d={d} onClose={() => setOpen(false)} />}
    </>
  );
}

function WithdrawSheet({ d, onClose }: { d: Stats; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const w = d.withdraw;
  const [amount, setAmount] = useState(String(Math.floor(d.refBalance / 100)));
  const [method, setMethod] = useState('');
  const [details, setDetails] = useState('');
  const kop = Math.round((Number(amount) || 0) * 100);
  const fee = Math.floor((kop * w.feePercent) / 100);
  const bad = kop < w.min ? `Минимум — ${formatRub(w.min)}` : kop > d.refBalance ? 'Больше, чем на счёте' : details.trim().length < 5 ? 'Укажите реквизиты' : '';
  const send = useMutation({
    mutationFn: () => post('/referrals/withdraw', { amount: kop, method, details }),
    onSuccess: () => { haptic('success'); toast('Заявка отправлена. Выплата — после проверки администратором', 'success'); void qc.invalidateQueries({ queryKey: ['referrals'] }); void qc.invalidateQueries({ queryKey: ['withdrawals'] }); onClose(); },
    onError: (e) => { haptic('error'); toast(errorText(e), 'error'); },
  });
  return (
    <Sheet open onClose={onClose} title="Вывод средств">
      <div className="space-y-4">
        <Field label="Сумма, ₽" hint={`Доступно ${formatRub(d.refBalance)}, минимум ${formatRub(w.min)}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} /></Field>
        <Field label="Способ выплаты" hint={w.methods}><Input value={method} maxLength={60} onChange={(e) => setMethod(e.target.value)} placeholder="Например: СБП" /></Field>
        <Field label="Реквизиты" hint="Номер карты, телефон для СБП или адрес кошелька"><Input value={details} maxLength={300} onChange={(e) => setDetails(e.target.value)} placeholder="Куда отправить деньги" /></Field>
        {fee > 0 && <div className="text-sm text-muted">Комиссия {w.feePercent}%: {formatRub(fee)}. К выплате: <b className="text-fg">{formatRub(kop - fee)}</b></div>}
        <Button full disabled={Boolean(bad)} loading={send.isPending} onClick={() => send.mutate()}>{bad || 'Отправить заявку'}</Button>
        <p className="text-xs text-muted">Сумма сразу списывается со счёта и возвращается, если заявку отклонят.</p>
      </div>
    </Sheet>
  );
}

export default function Referrals() {
  const r = useReferrals();
  const cfg = useConfig();
  const d = r.data;
  if (r.isError) return <ErrorState message={errorText(r.error)} onRetry={() => r.refetch()} />;
  const link = d?.link ?? d?.webLink ?? '';
  const rankPct = d?.nextRank && d.rank ? Math.min(1, d.paid / d.nextRank.minPaid) : d?.nextRank ? 0 : 1;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Друзья" subtitle="Приглашайте и зарабатывайте — на двух уровнях" />
      {!d ? <Skeleton className="h-64 w-full !rounded-card" /> : (
        <>
          <ModePicker d={d} />
          <Card className="space-y-3 p-5">
            <CopyField value={link} label="Ваша ссылка" />
            <Button full icon={<Share2 className="h-4 w-4" />} onClick={() => share(link)}>Поделиться в Telegram</Button>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <Stat label="Приглашено" value={d.invited} />
              <Stat label="Оплатили" value={d.paid} />
              <Stat label="Заработано" value={formatRub(d.earnedBalance)} />
            </div>
            {(d.invitedLevel2 > 0 || d.earnedLevel2 > 0) && (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Друзья друзей" value={d.invitedLevel2} />
                <Stat label="С 2 уровня" value={formatRub(d.earnedLevel2)} />
              </div>
            )}
            {d.earnedDays > 0 && <div className="text-center text-sm text-muted">Получено дней подписки: <b className="text-fg">{d.earnedDays}</b></div>}
          </Card>

          <Link to="/referrals/tree" className="card flex items-center gap-4 p-4 transition active:scale-[.99]">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary"><GitBranch className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Мои приглашённые и дерево</div>
              <div className="text-sm text-muted">{d.invited ? `${d.invited} ${d.invited === 1 ? 'друг' : 'друзей'}${d.invitedLevel2 ? ` · ${d.invitedLevel2} на 2 уровне` : ''} — кто оплатил и сколько вы получили` : 'Здесь появятся ваши друзья и цепочка их приглашений'}</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
          </Link>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 font-semibold"><Award className="h-5 w-5 text-warning" /> Ваш ранг: {d.rank?.name ?? '—'}{d.rank && d.rank.percent > 0 && <Badge tone="success">+{d.rank.percent}%</Badge>}</div>
            {d.nextRank ? (
              <>
                <ProgressBar value={rankPct} />
                <div className="mt-1.5 text-xs text-muted">До ранга «{d.nextRank.name}» осталось оплативших друзей: {d.nextRank.left}</div>
              </>
            ) : <div className="text-sm text-muted">Вы достигли максимального ранга 🎉</div>}
            <ul className="mt-4 space-y-1.5">
              {d.ranks.map((x) => (
                <li key={x.name} className={cn('flex items-center justify-between rounded-btn px-3 py-2 text-sm', d.rank?.name === x.name ? 'bg-primary/10 font-semibold text-primary' : 'bg-surface-2 text-muted')}>
                  <span>{x.name}</span>
                  <span>от {x.minPaid} {x.minPaid === 1 ? 'друга' : 'друзей'}{x.percent ? ` · +${x.percent}%` : ''}{x.extraDays ? ` · +${x.extraDays} дн.` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>

          {d.partnerLinks.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 font-semibold"><Link2 className="h-5 w-5 text-primary" /> Партнёрские ссылки</div>
              <div className="space-y-3">
                {d.partnerLinks.map((p) => (
                  <div key={p.id} className="rounded-btn border border-border p-3">
                    <div className="mb-2 flex items-center justify-between"><span className="font-medium">{p.name}</span>{!p.active && <Badge tone="danger">Отключена</Badge>}</div>
                    <CopyField value={p.link ?? p.webLink} />
                    <div className="mt-2 flex gap-4 text-xs text-muted"><span><Users className="mr-1 inline h-3.5 w-3.5" />{p.registrations} регистраций</span><span>{p.clicks} переходов</span></div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!cfg.data?.referral.enabled && <Card className="p-4 text-sm text-muted">Реферальная программа временно приостановлена.</Card>}
        </>
      )}
    </div>
  );
}

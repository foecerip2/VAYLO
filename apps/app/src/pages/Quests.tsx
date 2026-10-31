import { Badge, Button, Card, EmptyState, ErrorState, ProgressBar, Skeleton, cn, useToast } from '@vpn/ui';
import { bytesToHuman, formatRub, pluralDays, type QuestDTO } from '@vpn/shared';
import { Lock, Trophy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, ChevronRight, Disc3, Flame, Gift, Link2, Megaphone, ShoppingBag, Target, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../components/Layout';
import { ApiError, errorText, post } from '../lib/api';
import { useConfig, useQuests, useRefreshAfterPayment } from '../lib/queries';
import { haptic, openExternal } from '../lib/tg';
import { Reward3D, burst } from '../three/lazy';

const ICON: Record<string, React.ReactNode> = {
  daily_checkin: <CalendarCheck className="h-5 w-5" />,
  join_channel: <Megaphone className="h-5 w-5" />,
  invite_friends: <Users className="h-5 w-5" />,
  first_payment: <ShoppingBag className="h-5 w-5" />,
  topup_total: <Wallet className="h-5 w-5" />,
  spend_total: <ShoppingBag className="h-5 w-5" />,
  have_subscription: <CheckCircle2 className="h-5 w-5" />,
  traffic_used: <Target className="h-5 w-5" />,
  open_link: <Link2 className="h-5 w-5" />,
};

const reward = (q: QuestDTO) => (q.rewardType === 'days' ? `+${q.rewardValue} ${pluralDays(q.rewardValue)}` : `+${formatRub(q.rewardValue)}`);
const val = (q: QuestDTO, v: number) => (q.type === 'topup_total' || q.type === 'spend_total' ? formatRub(v) : q.type === 'traffic_used' ? bytesToHuman(v) : String(v));

export default function Quests() {
  const q = useQuests();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefreshAfterPayment();
  const [busy, setBusy] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [won, setWon] = useState<{ code: string; title: string; icon: string; days: number }[]>([]);
  const cfg = useConfig();

  async function claim(x: QuestDTO) {
    setBusy(x.id);
    try {
      const r = await post<{ rewardType: 'days' | 'balance'; rewardValue: number; streak?: number; achievements?: { code: string; title: string; icon: string; days: number }[] }>(`/quests/${x.id}/claim`);
      haptic('success');
      setPulse((n) => n + 1);
      burst();
      toast(`Награда получена: ${r.rewardType === 'days' ? `+${r.rewardValue} ${pluralDays(r.rewardValue)}` : `+${formatRub(r.rewardValue)}`} 🎉`, 'success');
      if (r.achievements?.length) { setWon(r.achievements); haptic('success'); }
      await qc.invalidateQueries({ queryKey: ['quests'] });
      refresh();
    } catch (e) {
      haptic('error');
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(null);
    }
  }

  // достижения, выданные «задним числом» за уже выполненные задания, показываем один раз
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const f = (q.data?.newAchievements ?? []).filter((a) => !shown.current.has(a.code));
    if (f.length) { f.forEach((a) => shown.current.add(a.code)); setWon(f); haptic('success'); refresh(); }
  }, [q.data]);

  const list = q.data?.quests ?? [];
  const ready = list.filter((x) => x.claimable).length;
  const ach = q.data?.achievements ?? [];
  const earned = ach.filter((a) => a.earned).length;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Задания" subtitle="Выполняйте и получайте дни подписки и деньги на баланс" />
      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 !rounded-card" />)}</div>
      ) : q.isError ? (
        <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.enabled || !list.length ? (
        <Card><EmptyState title="Заданий пока нет" text="Загляните позже — скоро появятся новые." /></Card>
      ) : (
        <>
          <div className="hero-bg relative overflow-hidden rounded-[28px] p-5 text-white shadow-glow">
            <div className="blob pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm text-white/85"><Flame className="h-4 w-4" /> Серия ежедневных заходов</div>
                <div className="num font-display text-3xl font-extrabold leading-tight">{q.data.streak} {q.data.streak === 1 ? 'день' : q.data.streak < 5 && q.data.streak > 1 ? 'дня' : 'дней'}</div>
                {ready > 0 && <Badge tone="success" className="mt-2 !bg-white !text-[#047857]">{ready} к получению</Badge>}
              </div>
              <Reward3D pulseKey={pulse} className="h-[120px] w-[120px] shrink-0" fallback={<div className="flex h-[120px] w-[120px] items-center justify-center"><div className="css-coin !m-0 !h-[88px] !w-[88px]"><i style={{ fontSize: 38 }}>V</i></div></div>} />
            </div>
          </div>

          {cfg.data?.wheelEnabled !== false && (
            <Link to="/wheel" className="card flex items-center gap-4 p-4 transition active:scale-[.99]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/20 text-danger"><Disc3 className="h-6 w-6" /></div>
              <div className="min-w-0 flex-1"><div className="font-semibold">Колесо удачи</div><div className="text-sm text-muted">Бесплатный прокрут каждый день</div></div>
              <ChevronRight className="h-5 w-5 text-muted" />
            </Link>
          )}

          {ach.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold"><Trophy className="h-5 w-5 text-primary" /> Достижения</div>
                <Badge tone="primary">{earned} из {ach.length}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                {ach.map((a) => (
                  <div key={a.code} className={cn('relative min-w-0 rounded-2xl border p-3 text-center transition', a.earned ? 'border-primary/40 bg-primary/10 shadow-glow' : 'border-white/[.06] bg-white/[.02]')}>
                    <div className={cn('mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-[26px]', a.earned ? 'bg-primary/20' : 'bg-white/5 grayscale opacity-50')}>{a.earned ? a.icon : <Lock className="h-5 w-5 text-muted" />}</div>
                    <div className="mt-2 text-[13px] font-bold leading-tight">{a.title}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted">{a.text}</div>
                    {a.earned ? <div className="mt-1.5 text-[11px] font-semibold text-success">Получено · +{a.days} {pluralDays(a.days)}</div> : (
                      <div className="mt-1.5"><ProgressBar value={a.target ? a.progress / a.target : 0} /><div className="mt-1 text-[11px] text-muted">{a.progress} из {a.target} · приз +{a.days} {pluralDays(a.days)}</div></div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="space-y-3">
            {list.map((x) => {
              const pct = x.target ? x.progress / x.target : 0;
              return (
                <Card key={x.id} className={cn('p-4', x.claimed && 'opacity-60')}>
                  <div className="flex items-start gap-3.5">
                    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', x.claimed ? 'bg-success/15 text-success' : 'bg-primary/12 text-primary')}>{x.claimed ? <CheckCircle2 className="h-5 w-5" /> : (ICON[x.type] ?? <Gift className="h-5 w-5" />)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold leading-tight">{x.title}</div>
                        <Badge tone="primary" className="shrink-0">{reward(x)}</Badge>
                      </div>
                      {x.description && <div className="mt-0.5 text-sm text-muted">{x.description}</div>}
                      {x.type !== 'daily_checkin' && x.target > 1 && !x.claimed && (
                        <div className="mt-2.5">
                          <ProgressBar value={pct} />
                          <div className="mt-1 text-xs text-muted">{val(x, x.progress)} из {val(x, x.target)}</div>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {x.url && !x.claimed && <Button size="sm" variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={() => openExternal(x.url!)}>Перейти</Button>}
                        {x.claimed ? (
                          <span className="text-xs text-muted">{x.repeat === 'daily' ? 'Получено сегодня · завтра снова' : 'Награда получена'}</span>
                        ) : (
                          <Button size="sm" disabled={!x.claimable} loading={busy === x.id} onClick={() => claim(x)} icon={<Gift className="h-4 w-4" />}>{x.claimable ? 'Забрать награду' : 'Не выполнено'}</Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
      {won.length > 0 && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm" onClick={() => setWon([])} role="dialog" aria-label="Новое достижение">
          <div className="card w-full max-w-[340px] p-6 text-center" style={{ animation: 'vg-rise .5s cubic-bezier(.2,.8,.2,1) backwards' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-bold uppercase tracking-[.2em] text-primary">Новое достижение</div>
            {won.map((a) => (
              <div key={a.code} className="mt-4">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/20 text-[44px] shadow-glow">{a.icon}</div>
                <div className="mt-3 text-lg font-extrabold">{a.title}</div>
                <div className="text-sm text-success">Бонус: +{a.days} {pluralDays(a.days)} к подписке 🎁</div>
              </div>
            ))}
            <Button full className="mt-5" onClick={() => setWon([])}>Отлично!</Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

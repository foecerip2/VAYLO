import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '@vpn/ui';
import { formatRub, pluralDays, type MyRefNodeDTO } from '@vpn/shared';
import { ChevronDown, Crown, GitBranch, Share2, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { errorText } from '../lib/api';
import { useReferrals, useRefTree } from '../lib/queries';
import { openExternal } from '../lib/tg';

const SUB = { active: { t: 'Подписка активна', tone: 'success' }, trial: { t: 'Пробный период', tone: 'primary' }, expired: { t: 'Подписка закончилась', tone: 'warning' }, none: { t: 'Пока без подписки', tone: 'neutral' } } as const;
const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const initial = (n: string) => (n.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase();

function Earned({ n }: { n: MyRefNodeDTO }) {
  const parts = [n.earnedDays ? `+${n.earnedDays} ${pluralDays(n.earnedDays)}` : '', n.earnedBalance ? `+${formatRub(n.earnedBalance)}` : ''].filter(Boolean);
  return parts.length ? <span className="font-semibold text-success">{parts.join(' · ')}</span> : <span className="text-muted">{n.paid ? 'без награды' : 'ждём первую оплату'}</span>;
}

function Person({ n, level }: { n: MyRefNodeDTO; level: 1 | 2 }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base font-extrabold', n.paid ? 'bg-gradient-to-br from-primary to-primary-2 text-white shadow-glow' : 'bg-white/[.07] text-muted')}>{initial(n.name)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{n.name}</span>
          {n.paid && <Badge tone="success">Оплатил</Badge>}
        </div>
        <div className="truncate text-xs text-muted">{n.handle ? `${n.handle} · ` : ''}с {date(n.joinedAt)} · {SUB[n.sub].t}</div>
        <div className="mt-0.5 text-xs">{level === 1 ? 'Вы получили: ' : 'Вам за него: '}<Earned n={n} /></div>
      </div>
    </div>
  );
}

function Branch({ n, scheme }: { n: MyRefNodeDTO; scheme: { level2Days: number; level2Percent: number } }) {
  const [open, setOpen] = useState(n.children.length > 0 && n.children.length <= 3);
  const has = n.children.length > 0;
  return (
    <div className="relative">
      <div className="card p-3.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><Person n={n} level={1} /></div>
          {has && (
            <button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Показать его приглашённых" className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[.05] px-2.5 py-1.5 text-xs font-semibold">
              <Users className="h-3.5 w-3.5" />{n.children.length}<ChevronDown className={cn('h-3.5 w-3.5 transition', open && 'rotate-180')} />
            </button>
          )}
        </div>
        {!has && n.invited === 0 && <div className="mt-2 rounded-xl bg-white/[.03] px-3 py-1.5 text-xs text-muted">Пока никого не пригласил — как только позовёт друга и тот оплатит{scheme.level2Days || scheme.level2Percent ? `, вы получите ${[scheme.level2Days ? `${scheme.level2Days} ${pluralDays(scheme.level2Days)}` : '', scheme.level2Percent ? `${scheme.level2Percent}%` : ''].filter(Boolean).join(' и ')}` : ''} 🌱</div>}
      </div>
      {has && open && (
        <div className="relative ml-6 mt-2 space-y-2 border-l-2 border-dashed border-primary/30 pl-4">
          {n.children.map((c) => (
            <div key={c.id} className="relative rounded-2xl border border-white/[.07] bg-white/[.03] p-3">
              <span className="absolute -left-[18px] top-1/2 h-0.5 w-4 bg-primary/30" />
              <Person n={c} level={2} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReferralTree() {
  const t = useRefTree();
  const r = useReferrals();
  if (t.isError) return <ErrorState message={errorText(t.error)} onRetry={() => t.refetch()} />;
  const d = t.data;
  const link = r.data?.link ?? r.data?.webLink ?? '';
  const sc = d?.scheme;
  const l1 = sc ? [sc.days ? `${sc.days} ${pluralDays(sc.days)}` : '', sc.percent ? `${sc.percent}%` : ''].filter(Boolean).join(' или ') : '';
  const l2 = sc ? [sc.level2Days ? `${sc.level2Days} ${pluralDays(sc.level2Days)}` : '', sc.level2Percent ? `${sc.level2Percent}%` : ''].filter(Boolean).join(' или ') : '';
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Мои приглашённые" subtitle="Кого вы позвали, кто оплатил и что вы получили" right={<Link to="/referrals" className="text-sm font-semibold text-primary">К наградам</Link>} />
      {!d ? <Skeleton className="h-72 !rounded-card" /> : (
        <>
          <div className="hero-bg relative overflow-hidden rounded-[28px] p-5 text-white shadow-glow">
            <div className="blob pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
            <div className="relative grid grid-cols-3 gap-2 text-center">
              <div><div className="num text-3xl font-extrabold">{d.totals.level1}</div><div className="text-[11px] text-white/80">друзей</div></div>
              <div><div className="num text-3xl font-extrabold">{d.totals.level2}</div><div className="text-[11px] text-white/80">друзей друзей</div></div>
              <div><div className="num text-3xl font-extrabold">{d.totals.paid}</div><div className="text-[11px] text-white/80">оплатили</div></div>
            </div>
            <div className="relative mt-4 rounded-2xl bg-black/20 px-4 py-3 text-center text-sm">
              Вы получили: <b>{[d.totals.earnedDays ? `${d.totals.earnedDays} ${pluralDays(d.totals.earnedDays)}` : '', d.totals.earnedBalance ? formatRub(d.totals.earnedBalance) : ''].filter(Boolean).join(' и ') || 'пока ничего'}</b>
              {(d.totals.earnedDaysL2 > 0 || d.totals.earnedBalanceL2 > 0) && <div className="mt-0.5 text-xs text-white/80">из них с 2 уровня: {[d.totals.earnedDaysL2 ? `${d.totals.earnedDaysL2} ${pluralDays(d.totals.earnedDaysL2)}` : '', d.totals.earnedBalanceL2 ? formatRub(d.totals.earnedBalanceL2) : ''].filter(Boolean).join(' и ')}</div>}
            </div>
          </div>

          {(l1 || l2) && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 font-semibold"><GitBranch className="h-5 w-5 text-primary" /> Как это работает</div>
              <div className="relative space-y-2 pl-1">
                <div className="flex items-center gap-3 rounded-2xl bg-primary/10 p-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/25 text-primary"><Crown className="h-4 w-4" /></div><div className="text-sm"><b>Вы</b> приглашаете друга и получаете <b>{l1 || '—'}</b>{sc?.recurring ? ' (процент — с каждой его оплаты)' : ''}</div></div>
                <div className="ml-5 flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.03] p-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"><UserRound className="h-4 w-4" /></div><div className="text-sm">Друг приглашает своего друга — и вы получаете ещё <b>{l2 || 'бонус'}</b>, а друг — свою награду {l1 ? `(${l1})` : ''}</div></div>
              </div>
              <p className="mt-2 text-xs text-muted">Чем больше цепочка — тем больше наград. Дни начисляются за первую оплату, режим (дни или деньги) можно менять на странице «Друзья».</p>
            </Card>
          )}

          {!d.nodes.length ? (
            <Card><EmptyState icon={<Users className="h-6 w-6" />} title="Пока никого нет" text="Отправьте ссылку другу — он появится здесь, как только зарегистрируется." action={link ? <Button icon={<Share2 className="h-4 w-4" />} onClick={() => openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Быстрый и надёжный VPN — попробуй:')}`)}>Поделиться ссылкой</Button> : undefined} /></Card>
          ) : (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"><Crown className="h-3.5 w-3.5" /> Вы · дерево приглашений</div>
              <div className="space-y-3 border-l-2 border-primary/40 pl-4">
                {d.nodes.map((n) => <Branch key={n.id} n={n} scheme={d.scheme} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

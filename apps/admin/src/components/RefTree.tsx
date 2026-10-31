import { Badge, Card, Skeleton } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { get } from '../lib/api';
import { fmtDate, fmtDateTime, rub } from '../lib/format';

export interface RefNode { id: string; name: string; username: string | null; tgId: number | null; joinedAt: string; sub: 'active' | 'trial' | 'expired' | 'none'; paid: boolean; firstPaidAt: string | null; earnedBalance: number; earnedDays: number; invited: number; via?: { id: string; name: string } | null }
interface Tree {
  user: { id: string; name: string; username: string | null; joinedAt: string; code: string };
  referrer: { id: string; name: string; username: string | null; tgId: number | null; joinedAt: string } | null;
  totals: { level1: number; level2: number; paid: number; earnedBalance: number; earnedDays: number };
  level1: RefNode[];
  level2: RefNode[];
}
const SUB: Record<RefNode['sub'], { label: string; tone: 'success' | 'primary' | 'danger' | 'neutral' }> = {
  active: { label: 'Подписка', tone: 'success' }, trial: { label: 'Триал', tone: 'primary' }, expired: { label: 'Истекла', tone: 'danger' }, none: { label: 'Без подписки', tone: 'neutral' },
};

function Person({ n, onOpen, level2 }: { n: RefNode; onOpen?: (id: string) => void; level2?: boolean }) {
  return (
    <button type="button" onClick={() => onOpen?.(n.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm transition hover:bg-surface-2">
      <div className="min-w-0">
        <div className="truncate font-medium">{n.name}{n.username && <span className="ml-1 font-normal text-muted">@{n.username}</span>}</div>
        <div className="text-xs text-muted">пришёл {fmtDateTime(n.joinedAt)}{level2 && n.via ? ` · через ${n.via.name}` : ''}{n.invited > 0 ? ` · привёл ${n.invited}` : ''}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex gap-1">{n.paid && <Badge tone="success">оплатил</Badge>}<Badge tone={SUB[n.sub].tone}>{SUB[n.sub].label}</Badge></div>
        {(n.earnedBalance > 0 || n.earnedDays > 0) && <span className="text-xs text-success">+{n.earnedBalance > 0 ? rub(n.earnedBalance) : ''}{n.earnedBalance > 0 && n.earnedDays > 0 ? ' · ' : ''}{n.earnedDays > 0 ? `${n.earnedDays} дн.` : ''}</span>}
      </div>
    </button>
  );
}

export function RefTree({ userId, onOpen }: { userId: string; onOpen?: (id: string) => void }) {
  const q = useQuery({ queryKey: ['ref-tree', userId], queryFn: () => get<Tree>(`/users/${userId}/referrals`) });
  const [lvl, setLvl] = useState<1 | 2>(1);
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (!q.data) return <p className="text-sm text-muted">Не удалось загрузить рефералов</p>;
  const t = q.data;
  const list = lvl === 1 ? t.level1 : t.level2;
  return (
    <div className="space-y-3">
      <Card className="p-3 text-sm">
        {t.referrer ? (
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => onOpen?.(t.referrer!.id)}>
            <span>Пригласил: <b>{t.referrer.name}</b>{t.referrer.username && <span className="text-muted"> @{t.referrer.username}</span>}</span>
            <ArrowUpRight className="h-4 w-4 text-muted" />
          </button>
        ) : <span className="text-muted">Пришёл сам (без реферальной ссылки)</span>}
        <div className="mt-1 text-xs text-muted">Код: <span className="font-mono">{t.user.code}</span> · с нами с {fmtDate(t.user.joinedAt)}</div>
      </Card>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[['1 ур.', t.totals.level1], ['2 ур.', t.totals.level2], ['Оплатили', t.totals.paid], ['Заработал', t.totals.earnedBalance ? rub(t.totals.earnedBalance) : t.totals.earnedDays ? `${t.totals.earnedDays} дн.` : '0']].map(([l, v]) => (
          <div key={String(l)} className="rounded-btn bg-surface-2 px-2 py-2"><div className="text-base font-semibold">{v}</div><div className="text-[11px] text-muted">{l}</div></div>
        ))}
      </div>
      <div className="flex gap-2 text-sm">
        {([1, 2] as const).map((l) => (
          <button key={l} type="button" onClick={() => setLvl(l)} className={`rounded-full px-3 py-1 ${lvl === l ? 'bg-primary text-white' : 'bg-surface-2 text-muted'}`}>{l === 1 ? `Привёл (${t.totals.level1})` : `Друзья друзей (${t.totals.level2})`}</button>
        ))}
      </div>
      {list.length === 0 ? <p className="text-sm text-muted">Пока никого</p> : <Card className="max-h-96 divide-y divide-border overflow-y-auto">{list.map((n) => <Person key={n.id} n={n} onOpen={onOpen} level2={lvl === 2} />)}</Card>}
    </div>
  );
}

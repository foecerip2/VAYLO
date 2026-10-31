import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '@vpn/ui';
import { formatRub, type AddonProductDTO } from '@vpn/shared';
import { Gauge, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { PurchaseSheet } from '../components/Purchase';
import { useAddons } from '../lib/queries';
import { errorText } from '../lib/api';
import { haptic } from '../lib/tg';



export default function Addons() {
  const q = useAddons();
  const [sel, setSel] = useState<AddonProductDTO | null>(null);
  const d = q.data;
  const products=(d?.products??[]).filter(p=>p.kind==='devices'||p.kind==='lte');

  const groups: { kind: AddonProductDTO['kind']; title: string; text: string; icon: React.ReactNode }[] = [
    { kind: 'devices', title: 'Дополнительные устройства', text: 'Дополнительные места на срок непрерывной подписки', icon: <Smartphone className="h-5 w-5" /> },
    { kind: 'lte', title: 'Трафик LTE · белые списки', text: 'Пакет действует 30 календарных дней. Общий VPN-трафик безлимитный', icon: <Gauge className="h-5 w-5" /> },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Докупки" subtitle="Дополнительные устройства и пакеты трафика для LTE" />
      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 !rounded-card" />)}</div>
      ) : q.isError ? (
        <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : !d?.enabled || !products.length ? (
        <Card><EmptyState title="Докупок пока нет" text="Когда администратор добавит дополнительные пакеты, они появятся здесь." /></Card>
      ) : (
        <>
          {!d.active && (
            <Card className="border-warning/40 bg-warning/10 p-4 text-sm">Докупки доступны при активной подписке. <Link to="/plans" className="font-semibold text-primary underline">Выбрать тариф</Link></Card>
          )}
          {groups.map((g) => {
            const items = products.filter((p) => p.kind === g.kind);
            if (!items.length) return null;
            return (
              <section key={g.kind}>
                <div className="mb-2.5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">{g.icon}</div>
                  <div><h2 className="font-semibold leading-tight">{g.title}</h2><p className="text-xs text-muted">{g.text}</p></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map((p) => (
                    <button key={p.id} disabled={!d.active || p.available === false} onClick={() => { haptic('light'); setSel(p); }} className={cn('card flex items-center gap-4 p-4 text-left transition active:scale-[.985] hover:border-primary/50 disabled:opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-muted">
                          {p.kind === 'devices' ? `+${p.qty} устр.` : (p.kind === 'traffic'||p.kind==='lte') ? `+${p.qty} ГБ${p.kind==='lte'?' LTE · 30 дней':''}` : `${p.qty} ГБ · ${p.durationDays ? p.durationDays + ' дн.' : 'до перерыва в подписке'}`}
                          {p.description ? ` · ${p.description}` : ''}
                          {p.unavailableReason && <span className="mt-1 block text-warning">{p.unavailableReason}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="num font-bold">{formatRub(p.finalPrice)}</div>
                        {p.finalPrice < p.price && <div className="text-xs text-muted line-through">{formatRub(p.price)}</div>}
                        {p.owned && <Badge tone="success">Подключено</Badge>}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

        </>
      )}
      <PurchaseSheet item={sel ? { kind: 'addon', addon: sel } : null} onClose={() => setSel(null)} />
    </div>
  );
}

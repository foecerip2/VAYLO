import { Badge, Card, EmptyState, ErrorState, Skeleton, cn } from '@vpn/ui';
import { Globe } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { useNodes } from '../lib/queries';
import { errorText } from '../lib/api';
import { haptic } from '../lib/tg';
import { Globe3D } from '../three/lazy';
import { RecommendedNode } from '../components/locations/RecommendedNode';

export function flag(code?: string | null): string {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export default function Locations() {
  const nodes = useNodes();
  const [sel, setSel] = useState<string | null>(null);
  const pick = (id: string) => { haptic('light'); setSel(id); };
  const online = nodes.data?.filter((n) => n.online && !n.stale && n.kind !== 'location').length ?? 0;
  return (
    <div className="animate-fade-up">
      <PageHeader title="Локации" subtitle="Выбирайте сервер в VPN-клиенте. Доступность из вашей сети может отличаться." />
      <RecommendedNode />
      {nodes.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] w-full !rounded-card" />)}</div>
      ) : nodes.isError ? (
        <ErrorState message={errorText(nodes.error)} onRetry={() => nodes.refetch()} />
      ) : !nodes.data?.length ? (
        <Card><EmptyState icon={<Globe className="h-6 w-6" />} title="Список серверов пуст" text="Серверы появятся здесь, как только администратор подключит их." /></Card>
      ) : (
        <>
          <Card className="mb-4 overflow-hidden !rounded-[28px]">
            <Globe3D nodes={nodes.data} selectedId={sel} onSelect={pick} />
            <div className="flex items-center justify-between gap-3 px-4 pb-3 text-xs text-muted">
              <span className="min-w-0">Вращайте · щипок или +/− для приближения · тап по точке</span>
              <span className="shrink-0 whitespace-nowrap font-semibold text-success">{online} на связи</span>
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {nodes.data.map((n) => (
              <button key={n.id} onClick={() => pick(n.id)} className={cn('card flex w-full min-w-0 items-center gap-3 p-4 text-left transition active:scale-[.99]', sel === n.id && '!border-primary shadow-glow')}>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-[26px]">{flag(n.countryCode)}</div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 break-words font-semibold leading-tight">{n.name}</div>
                  <div className="text-xs text-muted">{n.kind === 'location' ? 'Каталожная локация' : n.stale ? 'Статус устарел' : n.checkedAt ? `Обновлено ${new Date(n.checkedAt).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}` : 'Состояние сервера'}</div>
                </div>
                <Badge className="shrink-0" tone={n.kind === 'location' || n.stale ? 'neutral' : n.online ? 'success' : 'warning'}>
                  <span className={`h-1.5 w-1.5 rounded-full ${n.online ? 'bg-success' : 'bg-danger'}`} />
                  {n.kind === 'location' ? 'В каталоге' : n.stale ? 'Неизвестно' : n.online ? 'На связи' : 'Нет связи'}
                </Badge>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

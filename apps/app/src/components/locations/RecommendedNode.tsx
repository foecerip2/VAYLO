import { Card } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { get } from '../../lib/api';

interface Rec { enabled: boolean; mode?: 'evidence' | 'fallback'; recommendedNodeId?: string; ranked?: { nodeId: string; label: string; quality: string; evidenceCount: number; checkedAt: string | null; reasons: string[] }[] }

/** Подсказка, а не переключатель: профиль и конфигурация клиента не меняются. Скрыта, если флаг выключен или данных недостаточно. */
export function RecommendedNode() {
  const q = useQuery({ queryKey: ['node-rec'], queryFn: () => get<Rec>('/nodes/recommendations'), staleTime: 60_000, retry: false });
  const d = q.data;
  if (!d?.enabled || d.mode !== 'evidence') return null;
  const best = d.ranked?.find((r) => r.nodeId === d.recommendedNodeId);
  if (!best) return null;
  return (
    <Card className="mb-3 flex items-start gap-3 p-3" role="note" aria-label="Рекомендация локации">
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="text-sm">
        <div className="font-medium">Сейчас лучше выбрать: {best.label}</div>
        <div className="text-xs text-muted">{best.reasons.join(' · ')}. Проверено {best.checkedAt ? new Date(best.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}. Это подсказка по тестовым замерам, а не гарантия — выбор за вами.</div>
      </div>
    </Card>
  );
}

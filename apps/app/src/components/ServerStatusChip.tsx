import { Freshness, StatusPill, type HealthTone } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { get } from '../lib/api';

interface View { overall: 'ok' | 'partial' | 'down' | 'unknown'; summary: string; updatedAt: string | null }
const TONE: Record<View['overall'], HealthTone> = { ok: 'ok', partial: 'warn', down: 'bad', unknown: 'unknown' };

/** Сводка статуса серверов на главной. Данные те же, что в боте. Скрыта, если статус не настроен. */
export function ServerStatusChip() {
  const q = useQuery({ queryKey: ['server-status'], queryFn: () => get<View>('/status/servers'), refetchInterval: 120_000, staleTime: 60_000, retry: false });
  const d = q.data;
  if (!d || !d.summary) return null;
  return (
    <Link to="/locations" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-1 py-2 min-h-11" aria-label="Статус серверов">
      <StatusPill tone={TONE[d.overall]}>{d.summary}</StatusPill>
      <Freshness at={d.updatedAt} />
    </Link>
  );
}

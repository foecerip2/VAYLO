import { WifiOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from './components';

export type HealthTone = 'ok' | 'warn' | 'bad' | 'unknown';
const DOT: Record<HealthTone, string> = { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-danger', unknown: 'bg-muted' };
const LABEL: Record<HealthTone, string> = { ok: 'Работает', warn: 'Есть замечания', bad: 'Проблема', unknown: 'Нет данных' };

/** Статус не только цветом: точка + текст (доступность для дальтоников и скринридеров). */
export function StatusPill({ tone, children, className }: { tone: HealthTone; children?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium', className)}>
      <span className={cn('h-2 w-2 rounded-full', DOT[tone])} aria-hidden />
      <span>{children ?? LABEL[tone]}</span>
    </span>
  );
}

/** «Обновлено N мин назад»; после порога помечается как устаревшее. */
export function Freshness({ at, staleAfterMin = 15, className }: { at: string | Date | null; staleAfterMin?: number; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  if (!at) return <span className={cn('text-xs text-muted', className)}>нет данных</span>;
  const min = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  const stale = min > staleAfterMin;
  return <span className={cn('text-xs', stale ? 'text-warning' : 'text-muted', className)}>{min < 1 ? 'обновлено только что' : min < 60 ? `обновлено ${min} мин назад` : `обновлено ${Math.floor(min / 60)} ч назад`}{stale ? ' · данные устарели' : ''}</span>;
}

export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener('online', u); window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
}

export function OfflineBanner() {
  const on = useOnline();
  if (on) return null;
  return <div role="status" className="mb-3 flex items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><WifiOff className="h-4 w-4 shrink-0" aria-hidden />Нет соединения. Показаны последние загруженные данные.</div>;
}

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AttentionDTO } from '@vpn/shared';
import { get } from './api';

const EMPTY: AttentionDTO = { items: [], total: 0, critical: 0 };

/** События, требующие внимания: опрашиваем раз в 30 секунд и при возврате на вкладку */
export function useAttention() {
  const q = useQuery({ queryKey: ['attention'], queryFn: () => get<AttentionDTO>('/attention'), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const data = q.data ?? EMPTY;
  // счётчик в заголовке вкладки: видно, даже когда админка открыта в фоне
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = data.total > 0 ? `(${data.total}) ${base}` : base;
    return () => { document.title = base; };
  }, [data.total]);
  const byPath: Record<string, { count: number; critical: boolean }> = {};
  for (const i of data.items) byPath[i.web] = { count: i.count, critical: i.level === 'critical' };
  return { ...data, byPath };
}

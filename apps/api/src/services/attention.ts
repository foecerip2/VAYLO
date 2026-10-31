import { ROLE_LEVEL, type AdminRole } from '@vpn/shared';
import { sql } from '../db/index.js';
import { SUPPORT_HAS_ACTIVITY_SQL } from './supportVisibility.js';

export interface AttentionItem {
  key: 'down' | 'unfulfilled' | 'network' | 'support' | 'withdrawals';
  /** critical — что-то сломано или клиент заплатил и не получил доступ; todo — ждёт ответа администратора */
  level: 'critical' | 'todo';
  count: number;
  title: string;
  web: string;
  mini: string;
}
export interface AttentionDTO { items: AttentionItem[]; total: number; critical: number }

/** Что требует внимания администратора прямо сейчас (для красного индикатора). Видны только разделы, доступные роли. */
export async function attentionFor(role: AdminRole): Promise<AttentionDTO> {
  const lvl = ROLE_LEVEL[role] ?? 0;
  const [r] = await sql()`
    select
      (select count(*)::int from monitor_state where status = 'down') as down,
      (select count(*)::int from payments where status = 'succeeded' and fulfilled_at is null and (fulfill_failed_at is not null or paid_at < now() - interval '3 minutes')) as unfulfilled,
      (select count(*)::int from net_issues where active) + (select count(*)::int from (select distinct on (probe_name, target) ok from net_probes where source = 'probe' and at > now() - interval '30 minutes' order by probe_name, target, at desc) x where not ok) as network,
      (select count(*)::int from support_tickets t where t.admin_archived_at is null and t.unread_admin and t.status <> 'closed' and t.mode = 'human' and ${sql().unsafe(SUPPORT_HAS_ACTIVITY_SQL)}) as support,
      (select count(*)::int from withdrawals where status = 'pending') as withdrawals`;
  const items: AttentionItem[] = [];
  if (r!.down > 0 && lvl >= ROLE_LEVEL.analyst) items.push({ key: 'down', level: 'critical', count: r!.down, title: 'Сервисы и ноды недоступны', web: '/monitoring', mini: '/admin/monitoring' });
  if (r!.unfulfilled > 0 && lvl >= ROLE_LEVEL.analyst) items.push({ key: 'unfulfilled', level: 'critical', count: r!.unfulfilled, title: 'Оплачено, но доступ не выдан', web: '/payments', mini: '/admin/payments' });
  if (r!.network > 0 && lvl >= ROLE_LEVEL.analyst) items.push({ key: 'network', level: 'critical', count: r!.network, title: 'Нет доступа у операторов или проба не работает', web: '/network', mini: '/admin/network' });
  if (r!.support > 0 && lvl >= ROLE_LEVEL.support) items.push({ key: 'support', level: 'todo', count: r!.support, title: 'Новые сообщения в поддержку', web: '/support', mini: '/admin/support' });
  if (r!.withdrawals > 0 && lvl >= ROLE_LEVEL.analyst) items.push({ key: 'withdrawals', level: 'todo', count: r!.withdrawals, title: 'Заявки на вывод', web: '/withdrawals', mini: '/admin/withdrawals' });
  return { items, total: items.reduce((n, i) => n + i.count, 0), critical: items.filter((i) => i.level === 'critical').reduce((n, i) => n + i.count, 0) };
}

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, PageTitle, Pagination, type Column } from '../components/kit';
import { get } from '../lib/api';
import { fmtDateTime } from '../lib/format';

interface A { id: number; admin_email: string | null; action: string; entity: string | null; entity_id: string | null; data: unknown; ip: string | null; created_at: string }

export default function Audit() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', page], queryFn: () => get<{ total: number; page: number; limit: number; items: A[] }>(`/audit?page=${page}`), placeholderData: (p) => p });
  const cols: Column<A>[] = [
    { key: 'd', header: 'Время', primary: true, render: (a) => fmtDateTime(a.created_at) },
    { key: 'a', header: 'Админ', render: (a) => a.admin_email ?? '—' },
    { key: 'ac', header: 'Действие', render: (a) => <span className="font-mono text-xs">{a.action}</span> },
    { key: 'e', header: 'Объект', render: (a) => (a.entity ? `${a.entity}${a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ''}` : '—') },
    { key: 'ip', header: 'IP', render: (a) => a.ip ?? '—' },
  ];
  return (
    <div className="animate-fade-up">
      <PageTitle title="Журнал действий" subtitle="Кто и что менял в админ-панели" />
      <DataTable columns={cols} rows={q.data?.items} loading={q.isLoading} empty="Записей нет" />
      {q.data && <Pagination page={q.data.page} limit={q.data.limit} total={q.data.total} onChange={setPage} />}
    </div>
  );
}

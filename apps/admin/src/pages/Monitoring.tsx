import { Badge, Button, Card, Skeleton, cn, useToast } from '@vpn/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { PageTitle } from '../components/kit';
import { ApiError, get, post } from '../lib/api';
import { fmtDateTime } from '../lib/format';

interface State { target: string; label: string; status: 'up' | 'down' | 'unknown'; fails: number; since: string; checked_at: string | null; detail: string | null }
interface Ev { id: number; label: string; status: string; detail: string | null; created_at: string }
const dot = (st: string) => <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', st === 'up' ? 'bg-success' : st === 'down' ? 'bg-danger' : 'bg-muted')} />;

export default function MonitoringPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['monitoring'], queryFn: () => get<{ intervalSeconds: number; enabled: boolean; maintenance: boolean; state: State[]; events: Ev[] }>('/monitoring'), refetchInterval: 20_000 });
  const run = useMutation({ mutationFn: () => post('/monitoring/run'), onSuccess: () => { toast('Проверка выполнена', 'success'); void q.refetch(); }, onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error') });
  const down = q.data?.state.filter((s) => s.status === 'down') ?? [];
  return (
    <div className="animate-fade-up space-y-5">
      <PageTitle title="Мониторинг" subtitle={`Проверка связи с панелью каждые ${Math.round((q.data?.intervalSeconds ?? 60) / 60)} мин. Уведомления об авариях и восстановлении — в Telegram.`} actions={<Button icon={<RefreshCw className="h-4 w-4" />} loading={run.isPending} onClick={() => run.mutate()}>Проверить сейчас</Button>} />
      <Card className="p-4 text-sm text-muted">Статус ноды означает связь с панелью. Выберите другую локацию в VPN-клиенте при проблемах подключения.</Card>
      {q.data && !q.data.enabled && <Card className="border-warning/40 bg-warning/10 p-4 text-sm">Мониторинг выключен в настройках.</Card>}
      {q.data?.maintenance && <Card className="border-warning/40 bg-warning/10 p-4 text-sm">⚙️ Сейчас включены технические работы — покупки и пополнения заблокированы.</Card>}
      {down.length > 0 && <Card className="border-danger/40 bg-danger/10 p-4 text-sm"><b>Проблемы:</b> {down.map((d) => d.label).join(', ')}</Card>}
      {q.isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="divide-y divide-border">
            <div className="flex items-center gap-2 p-4 font-semibold"><Activity className="h-5 w-5 text-primary" /> Состояние</div>
            {!q.data?.state.length && <div className="p-4 text-sm text-muted">Данных пока нет — первая проверка пройдёт в течение минуты.</div>}
            {q.data?.state.map((s) => (
              <div key={s.target} className="flex items-center gap-3 p-4">
                {dot(s.status)}
                <div className="min-w-0 flex-1"><div className="font-medium">{s.label}</div>{s.detail && <div className="truncate text-xs text-muted">{s.detail}</div>}</div>
                <div className="text-right"><Badge tone={s.status === 'up' ? 'success' : s.status === 'down' ? 'danger' : 'neutral'}>{s.status === 'up' ? 'работает' : s.status === 'down' ? 'авария' : '—'}</Badge><div className="mt-0.5 text-[11px] text-muted">{s.checked_at ? fmtDateTime(s.checked_at) : ''}</div></div>
              </div>
            ))}
          </Card>
          <Card className="divide-y divide-border">
            <div className="p-4 font-semibold">События</div>
            {!q.data?.events.length && <div className="p-4 text-sm text-muted">Событий пока не было.</div>}
            {q.data?.events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                {dot(e.status)}<span className="min-w-0 flex-1 truncate">{e.label}{e.detail ? ` — ${e.detail}` : ''}</span><span className="shrink-0 text-xs text-muted">{fmtDateTime(e.created_at)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

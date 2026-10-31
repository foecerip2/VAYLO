import { Badge, Button, Card, CopyField, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, Switch, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, RefreshCw, Radio, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { PageTitle } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';

interface Node { id: string; name: string; address: string; countryCode: string | null; online: boolean; disabled: boolean; usersOnline: number }
const flag = (cc: string | null) => (cc && /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌐');

interface Agent { node_uuid: string; last_ip: string | null; last_seen: string | null; dns_name: string | null }
interface Change { node_name: string | null; old_ip: string | null; new_ip: string; source: string; ok: boolean; detail: string | null; created_at: string }
const ago = (d: string | null) => { if (!d) return 'никогда'; const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000); return s < 90 ? 'только что' : s < 3600 ? `${Math.round(s / 60)} мин назад` : s < 86400 ? `${Math.round(s / 3600)} ч назад` : `${Math.round(s / 86400)} дн назад`; };

function NodeIpSheet({ node, agent, onClose }: { node: Node; agent?: Agent; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [ip, setIp] = useState('');
  const [dns, setDns] = useState(agent?.dns_name ?? '');
  const [cmd, setCmd] = useState<string | null>(null);
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
  const done = () => qc.invalidateQueries({ queryKey: ['nodeip'] });
  const issue = useMutation({ mutationFn: () => post<{ installCommand: string }>(`/nodeip/${node.id}/agent`, { dnsName: dns || null }), onSuccess: (r) => { setCmd(r.installCommand); done(); }, onError });
  const revoke = useMutation({ mutationFn: () => del(`/nodeip/${node.id}/agent`), onSuccess: () => { toast('Агент отключён', 'success'); done(); onClose(); }, onError });
  const saveDns = useMutation({ mutationFn: () => put(`/nodeip/${node.id}/dns`, { dnsName: dns || null }), onSuccess: () => { toast('Сохранено', 'success'); done(); }, onError });
  const manual = useMutation({ mutationFn: () => post<{ ok: boolean; steps: string[] }>(`/nodeip/${node.id}/ip`, { ip: ip.trim() }), onSuccess: (r) => { toast(r.ok ? 'IP обновлён' : r.steps.join('; '), r.ok ? 'success' : 'error'); done(); qc.invalidateQueries({ queryKey: ['nodes'] }); }, onError });
  return (
    <Sheet open onClose={onClose} title={`IP ноды ${node.name}`}>
      <div className="space-y-5">
        <p className="text-sm text-muted">Если сервер заблокирован и вы сменили ему IP, агент на ноде сам сообщит новый адрес — панель подставит его в ноду и хосты Remnawave (и в DNS Cloudflare, если задано имя).</p>
        <section className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-semibold">Агент на сервере</h3><Badge tone={agent ? (agent.last_seen && Date.now() - new Date(agent.last_seen).getTime() < 180000 ? 'success' : 'warning') : 'neutral'}>{agent ? `был ${ago(agent.last_seen)}` : 'не установлен'}</Badge></div>
          <Field label="DNS-имя (необязательно)" hint="Если нода адресуется доменом и он в Cloudflare — A-запись обновится сама"><Input value={dns} onChange={(e) => setDns(e.target.value)} placeholder="node1.example.com" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => issue.mutate()} loading={issue.isPending}>{agent ? 'Перевыпустить токен' : 'Создать агента'}</Button>
            {agent && <Button variant="secondary" onClick={() => saveDns.mutate()} loading={saveDns.isPending}>Сохранить DNS</Button>}
            {agent && <Button variant="danger" onClick={() => revoke.mutate()} loading={revoke.isPending}>Отключить</Button>}
          </div>
          {cmd && (<div className="space-y-2"><p className="text-sm">Выполните на сервере ноды (токен показывается один раз):</p><CopyField value={cmd} /></div>)}
          {agent?.last_ip && <p className="text-xs text-muted">Последний IP от агента: {agent.last_ip}</p>}
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">Сменить IP вручную</h3>
          <Field label="Новый публичный IP"><Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.10" inputMode="decimal" /></Field>
          <Button variant="secondary" disabled={!ip.trim()} onClick={() => manual.mutate()} loading={manual.isPending}>Применить</Button>
        </section>
      </div>
    </Sheet>
  );
}

function NodeIpSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: { nodeip: Record<string, any> }; mask: string }>('/settings') });
  const [f, setF] = useState<Record<string, any> | null>(null);
  const cur = f ?? s.data?.settings.nodeip;
  const save = useMutation({ mutationFn: () => put('/settings/nodeip', f), onSuccess: () => { toast('Сохранено', 'success'); setF(null); qc.invalidateQueries({ queryKey: ['settings'] }); }, onError: (e) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error') });
  if (!cur) return null;
  const set = (k: string, v: unknown) => setF({ ...cur, [k]: v });
  return (
    <Card className="mt-6 space-y-3 p-4">
      <h3 className="flex items-center gap-2 font-semibold"><Settings2 className="h-4 w-4" /> Автоперенастройка при смене IP</h3>
      <Switch checked={!!cur.enabled} onChange={(v) => set('enabled', v)} label="Принимать отчёты агентов" />
      <Switch checked={!!cur.update_hosts} onChange={(v) => set('update_hosts', v)} label="Менять старый IP в хостах Remnawave" />
      <Switch checked={!!cur.restart_node} onChange={(v) => set('restart_node', v)} label="Перезапускать ноду после смены" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cloudflare API-токен" hint="Права: Zone → DNS → Edit"><Input type="password" value={cur.cloudflare_token ?? ''} onChange={(e) => set('cloudflare_token', e.target.value)} autoComplete="off" /></Field>
        <Field label="Cloudflare Zone ID"><Input value={cur.cloudflare_zone_id ?? ''} onChange={(e) => set('cloudflare_zone_id', e.target.value)} /></Field>
      </div>
      {f && <Button onClick={() => save.mutate()} loading={save.isPending}>Сохранить</Button>}
    </Card>
  );
}

export default function Nodes() {
  const ni = useQuery({ queryKey: ['nodeip'], queryFn: () => get<{ agents: Agent[]; history: Change[] }>('/nodeip'), refetchInterval: 30000 });
  const [open, setOpen] = useState<Node | null>(null);
  const q = useQuery({ queryKey: ['nodes'], queryFn: () => get<{ configured: boolean; error?: string; items: Node[] }>('/nodes'), refetchInterval: 30000 });
  return (
    <div className="animate-fade-up">
      <PageTitle title="Ноды" subtitle="Серверы из панели Remnawave. Добавлять и менять ноды нужно в самой панели." actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => q.refetch()} loading={q.isFetching}>Обновить</Button>} />
      {q.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        : q.isError ? <ErrorState message="Не удалось загрузить ноды" onRetry={() => q.refetch()} />
        : !q.data?.configured ? <Card><EmptyState icon={<Globe2 className="h-6 w-6" />} title="Remnawave не подключена" text="Укажите адрес и токен в Настройки → Remnawave." /></Card>
        : q.data.error ? <ErrorState message={`Remnawave: ${q.data.error}`} onRetry={() => q.refetch()} />
        : !q.data.items.length ? <Card><EmptyState icon={<Globe2 className="h-6 w-6" />} title="Нод нет" text="Добавьте ноду в панели Remnawave." /></Card>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{q.data.items.map((n) => (
          <Card key={n.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3"><span className="text-2xl">{flag(n.countryCode)}</span><div className="min-w-0"><div className="truncate font-semibold">{n.name}</div><div className="truncate text-xs text-muted">{n.address}</div></div></div>
              <Badge tone={n.disabled ? 'neutral' : n.online ? 'success' : 'danger'}>{n.disabled ? 'Отключена' : n.online ? 'Онлайн' : 'Офлайн'}</Badge>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-muted"><span>Подключено: <span className="font-medium text-fg">{n.usersOnline}</span></span>
              <Button size="sm" variant="secondary" icon={<Radio className="h-4 w-4" />} onClick={() => setOpen(n)}>{ni.data?.agents.some((a) => a.node_uuid === n.id) ? 'IP · агент ✓' : 'IP · агент'}</Button></div>
          </Card>))}</div>}
      {open && <NodeIpSheet node={open} agent={ni.data?.agents.find((a) => a.node_uuid === open.id)} onClose={() => setOpen(null)} />}
      <NodeIpSettings />
      {!!ni.data?.history.length && (
        <Card className="mt-6 p-4"><h3 className="mb-3 font-semibold">История смен IP</h3>
          <div className="space-y-2 text-sm">{ni.data.history.map((h, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1"><Badge tone={h.ok ? 'success' : 'warning'}>{h.ok ? 'ок' : 'проверьте'}</Badge><span className="font-medium">{h.node_name}</span><span className="text-muted">{h.old_ip ?? '—'} → {h.new_ip}</span><span className="text-xs text-muted">{h.source === 'agent' ? 'агент' : 'вручную'} · {ago(h.created_at)}</span></div>))}</div></Card>)}
    </div>
  );
}

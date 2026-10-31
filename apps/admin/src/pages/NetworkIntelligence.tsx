import { Badge, Button, Card, Input, Select, useToast, cn } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, del, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface Cell { evidence: 'real_xray_probe' | 'browser_heuristic'; operator: string; os: string; target: string; samples: number; successRate: number | null; p50: number | null; p95: number | null; lastAt: string; confidence: 'insufficient' | 'low' | 'ok' }
interface Summary { enabled: boolean; window?: string; dataAsOf?: string; cells: Cell[] }
interface Incident { id: string; target: string; operator: string; state: 'suspected' | 'confirmed' | 'recovering' | 'resolved'; severity: string; startedAt: string; evidenceCount: number }
interface Token { id: string; label: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null }
const STATE: Record<Incident['state'], string> = { suspected: 'Подозрение', confirmed: 'Подтверждён', recovering: 'Восстанавливается', resolved: 'Решён' };
const EV = { real_xray_probe: 'Реальный Xray', browser_heuristic: 'Браузерная эвристика' } as const;
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

export default function NetworkIntelligence() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canAdmin = can('admin');
  const [win, setWin] = useState('24h');
  const [os, setOs] = useState('');
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const sum = useQuery({ queryKey: ['ni-sum', win, os], queryFn: () => get<Summary>(`/network-intelligence/summary?window=${win}${os ? `&os=${os}` : ''}`), refetchInterval: 60_000 });
  const inc = useQuery({ queryKey: ['ni-inc'], queryFn: () => get<{ enabled: boolean; items: Incident[] }>('/network-intelligence/incidents'), refetchInterval: 60_000 });
  const tokens = useQuery({ queryKey: ['ni-tok'], queryFn: () => get<{ items: Token[]; scopedAuth: boolean }>('/probe-tokens'), enabled: canAdmin });
  const ack = useMutation({ mutationFn: (id: string) => post(`/network-intelligence/incidents/${id}/ack`, { note: 'Подтверждено вручную' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ni-inc'] }); toast('Подтверждено', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const issue = useMutation({ mutationFn: () => post<{ token: string }>('/probe-tokens', { label: label.trim() }), onSuccess: (r) => { setFresh(r.token); setLabel(''); qc.invalidateQueries({ queryKey: ['ni-tok'] }); }, onError: (e) => toast(errMsg(e), 'error') });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/probe-tokens/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['ni-tok'] }), onError: (e) => toast(errMsg(e), 'error') });

  if (sum.isLoading) return <div className="space-y-3"><PageTitle title="Сеть: аналитика" /><Sk className="h-40" /></div>;
  if (sum.isError) return <div className="space-y-3"><PageTitle title="Сеть: аналитика" /><Empty title="Не удалось загрузить" text={errMsg(sum.error)} /></div>;
  const data = sum.data!;
  return (
    <div className="space-y-5">
      <PageTitle title="Сеть: аналитика" />
      {!data.enabled && <Card className="p-4 text-sm text-muted">Модуль выключен (NETWORK_INTELLIGENCE_ENABLED=false). Включите флаг в окружении API и перезапустите сервисы.</Card>}
      {data.enabled && (
        <>
          <div className="flex flex-wrap gap-2">
            <Select className="!w-auto min-w-40" value={win} onChange={(e) => setWin(e.target.value)} aria-label="Период"><option value="30m">30 минут</option><option value="24h">24 часа</option><option value="7d">7 дней</option></Select>
            <Select className="!w-auto min-w-40" value={os} onChange={(e) => setOs(e.target.value)} aria-label="ОС"><option value="">Все ОС</option><option value="ios">iOS</option><option value="android">Android</option><option value="other">Другое</option></Select>
          </div>
          <Section title="Инциденты">
            {!inc.data?.items.length ? <Empty title="Активных инцидентов нет" text="Это не гарантия доступности: если проб нет, данных тоже нет." /> : (
              <div className="space-y-2">
                {inc.data.items.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-fg/10 p-3 text-sm">
                    <Badge tone={i.state === 'confirmed' ? 'danger' : 'warning'}>{STATE[i.state]}</Badge>
                    <b>{i.target}</b><span className="text-muted">{i.operator} · с {fmtDateTime(i.startedAt)} · замеров {i.evidenceCount}</span>
                    {canAdmin && i.state !== 'confirmed' && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => ack.mutate(i.id)}>Подтвердить</Button>}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Матрица: оператор × цель">
            {!data.cells.length ? <Empty title="Нет данных за период" text="Запустите пробу или дождитесь замеров клиентов." /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="p-2">Источник</th><th className="p-2">Оператор</th><th className="p-2">ОС</th><th className="p-2">Цель</th><th className="p-2">n</th><th className="p-2">Успех</th><th className="p-2">p50 / p95, мс</th><th className="p-2">Обновлено</th></tr></thead>
                <tbody>{data.cells.map((c, i) => (
                  <tr key={i} className="border-t border-fg/10">
                    <td className="p-2">{EV[c.evidence]}</td><td className="p-2">{c.operator}</td><td className="p-2">{c.os}</td><td className="p-2">{c.target}</td><td className="p-2">{c.samples}</td>
                    <td className={cn('p-2 font-medium', c.successRate != null && c.successRate < 70 && 'text-danger')}>{c.successRate == null ? <span className="text-muted">Недостаточно данных</span> : `${c.successRate}%`}</td>
                    <td className="p-2">{c.p50 ?? '—'} / {c.p95 ?? '—'}</td><td className="p-2 text-muted">{fmtDateTime(c.lastAt)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            <p className="mt-2 text-xs text-muted">Браузерная эвристика не подтверждает работу VLESS. Процент не показывается при n&lt;10.</p>
          </Section>
        </>
      )}
      {canAdmin && (
        <Section title="Токены проб">
          <p className="mb-2 text-xs text-muted">Отдельный токен с правом только записи замеров. Режим «только токены» (NETPROBE_SCOPED_AUTH): {tokens.data?.scopedAuth ? 'включён' : 'выключен — общий INTERNAL_KEY ещё принимается'}.</p>
          <div className="mb-3 flex gap-2"><Input value={label} maxLength={60} placeholder="Название, напр. phone-beeline" onChange={(e) => setLabel(e.target.value)} /><Button disabled={label.trim().length < 2 || issue.isPending} onClick={() => issue.mutate()}>Выпустить</Button></div>
          {fresh && <Card className="mb-3 break-all p-3 text-xs"><b>Токен показывается один раз:</b><br /><code>{fresh}</code><br /><button className="mt-1 text-primary underline" onClick={() => setFresh(null)}>Я сохранил</button></Card>}
          <div className="space-y-2">{tokens.data?.items.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-fg/10 p-3 text-sm">
              <b>{t.label}</b><span className="text-muted">выпущен {fmtDateTime(t.createdAt)} · использован {t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : 'никогда'}</span>
              {t.revokedAt ? <Badge tone="neutral">Отозван</Badge> : <Button size="sm" variant="ghost" className="ml-auto" onClick={() => revoke.mutate(t.id)}>Отозвать</Button>}
            </div>))}</div>
        </Section>
      )}
    </div>
  );
}

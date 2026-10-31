import { Badge, Button, Card, Field, Input, Select, Switch, useToast, cn } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radar, SmartphoneNfc } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface Row { operator: string; target: string; kind: string; os: string; samples: number; okPct: number; medianMs: number | null; lastAt: string }
interface Data {
  settings: { enabled: boolean; min_samples: number; alert_below_pct: number };
  labels: Record<string, string>;
  rows: Row[];
  issues: { operator: string; target: string; since: string; okPct: number; samples: number }[];
  probes: { probe: string; operator: string; target: string; ok: boolean; ms: number | null; detail: string | null; at: string }[];
}
const OS: Record<string, string> = { ios: 'iPhone', android: 'Android', other: 'Другое' };
const tone = (p: number) => (p >= 90 ? 'bg-success/15 text-success' : p >= 60 ? 'bg-warning/15 text-warning' : 'bg-danger/15 text-danger');
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');
const targetName = (t: string) => (t === 'sub' ? 'Страница подписки' : t === 'api' ? 'API' : t.replace(/^host:/, 'Узел '));

export default function NetworkPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState(30);
  const q = useQuery({ queryKey: ['net', minutes], queryFn: () => get<Data>(`/net?minutes=${minutes}`), refetchInterval: 30_000 });
  const [s, setS] = useState<Data['settings'] | null>(null);
  useEffect(() => { if (q.data && !s) setS(q.data.settings); }, [q.data, s]);
  const save = useMutation({ mutationFn: (v: Data['settings']) => put('/net/settings', v), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['net'] }); void qc.invalidateQueries({ queryKey: ['attention'] }); toast('Сохранено', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });

  const d = q.data;
  const targets = d ? [...new Set(d.rows.map((r) => r.target))].sort((a, b) => (a === 'sub' ? -2 : a === 'api' ? -1 : 0) - (b === 'sub' ? -2 : b === 'api' ? -1 : 0) || a.localeCompare(b)) : [];
  const ops = d ? [...new Set(d.rows.map((r) => r.operator))] : [];
  const cell = (op: string, t: string) => {
    const rs = d!.rows.filter((r) => r.operator === op && r.target === t);
    if (!rs.length) return null;
    const n = rs.reduce((a, r) => a + r.samples, 0);
    const pct = Math.round(rs.reduce((a, r) => a + r.okPct * r.samples, 0) / n);
    const ms = rs.filter((r) => r.medianMs != null);
    return { n, pct, ms: ms.length ? Math.round(ms.reduce((a, r) => a + r.medianMs! * r.samples, 0) / ms.reduce((a, r) => a + r.samples, 0)) : null, detail: rs.map((r) => `${OS[r.os] ?? r.os}: ${r.okPct}% (${r.samples})`).join(' · ') };
  };

  return (
    <div className="animate-fade-up space-y-4">
      <PageTitle title="Доступность у операторов" subtitle="Реальные замеры из приложения у ваших клиентов и проба по ключу VLESS" />
      {q.isLoading || !d || !s ? (
        <div className="space-y-3"><Sk className="h-24" /><Sk className="h-64" /></div>
      ) : (
        <>
          {d.issues.length > 0 && (
            <Card className="space-y-1 border-danger/50 bg-danger/10 p-4" role="alert">
              <div className="flex items-center gap-2 text-sm font-bold text-danger"><span className="vg-alert dot !static" />Сейчас есть проблемы</div>
              {d.issues.map((i) => <div key={i.operator + i.target} className="text-sm">{d.labels[i.operator] ?? i.operator}: {targetName(i.target)} — успешно {i.okPct}% из {i.samples} замеров, с {fmtDateTime(i.since)}</div>)}
            </Card>
          )}

          <Section title="Замеры клиентов" description="Каждый клиент раз в 6 часов проверяет из Mini App страницу подписки, API и узлы. Оператор определяется по IP, сами адреса не сохраняются." right={
            <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Период"><option value={30}>30 минут</option><option value={360}>6 часов</option><option value={1440}>24 часа</option></Select>
          }>
            {!ops.length ? (
              <Empty icon={<Radar className="h-6 w-6" />} title="Пока нет замеров за этот период" text="Данные появятся, когда клиенты откроют приложение. Попробуйте период «24 часа»." />
            ) : (
              <div className="overflow-x-auto">
                <table className="vg w-full min-w-[520px] text-left text-sm">
                  <thead><tr className="text-xs uppercase tracking-wide text-muted"><th className="px-3 py-2 font-medium">Оператор</th>{targets.map((t) => <th key={t} className="px-3 py-2 font-medium">{targetName(t)}</th>)}</tr></thead>
                  <tbody>
                    {ops.map((op) => (
                      <tr key={op}>
                        <td className="px-3 py-2.5 font-semibold">{d.labels[op] ?? op}</td>
                        {targets.map((t) => { const c = cell(op, t); return <td key={t} className="px-3 py-2.5">{c ? <div><span title={c.detail} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', tone(c.pct))}>{c.pct}%<span className="font-normal opacity-80">· {c.n}{c.ms != null ? ` · ${c.ms} мс` : ''}</span></span><div className="mt-1 text-[11px] text-muted">{c.detail}</div></div> : <span className="text-muted">—</span>}</td>; })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted">В ячейке: доля успешных замеров · число замеров · медианная задержка. Под значением — разбивка по платформам. «Узел» оценивается грубо (порт достижим или нет), точный тест узлов делает проба по ключу ниже.</p>
              </div>
            )}
          </Section>

          <Section title="Проба по ключу VLESS" description="Скрипт поднимает xray с ключом тестового пользователя и ходит через каждый узел. Запускается на VPS или на телефоне с SIM нужного оператора." right={<Badge tone={d.probes.length ? 'success' : 'neutral'}>{d.probes.length ? 'Работает' : 'Не подключена'}</Badge>}>
            {!d.probes.length ? (
              <Empty icon={<SmartphoneNfc className="h-6 w-6" />} title="Проб пока нет" text="Создайте тестового пользователя «probe», возьмите его ссылку подписки и установите пробу командой install-probe.sh (см. инструкцию NETWORK-PROBE-UPDATE.md)." />
            ) : (
              <div className="divide-y divide-fg/10 rounded-2xl border border-fg/10">
                {d.probes.map((p) => (
                  <div key={p.probe + p.target} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', p.ok ? 'bg-success' : 'bg-danger')} />
                    <b className="min-w-0 flex-1 break-words">{p.target}</b>
                    <span className="text-muted">{p.probe}{p.operator !== 'other' ? ` · ${d.labels[p.operator]}` : ''}</span>
                    <span>{p.ok ? `${p.ms ?? '—'} мс` : p.detail ?? 'не работает'}</span>
                    <span className="text-xs text-muted">{fmtDateTime(p.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Настройки">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex items-center gap-3 text-sm md:col-span-3"><Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Замеры клиентов" />Собирать замеры из Mini App и присылать тревоги</label>
              <Field label="Минимум замеров для тревоги" hint="За 30 минут"><Input type="number" min={2} max={100} value={s.min_samples} onChange={(e) => setS({ ...s, min_samples: Number(e.target.value) })} /></Field>
              <Field label="Тревога, если успешно меньше, %"><Input type="number" min={5} max={90} value={s.alert_below_pct} onChange={(e) => setS({ ...s, alert_below_pct: Number(e.target.value) })} /></Field>
            </div>
            {can('admin') && <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate(s)}>Сохранить</Button>}
          </Section>
        </>
      )}
    </div>
  );
}

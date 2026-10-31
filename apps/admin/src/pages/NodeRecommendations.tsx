import { Card, StatusPill } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { ApiError, get } from '../lib/api';
import { fmtDateTime } from '../lib/format';

interface R { nodeId: string; label: string; quality: 'high' | 'medium' | 'unknown'; score: number | null; confidence: number; evidenceCount: number; checkedAt: string | null; reasons: string[] }
interface Data { enabled: boolean; mode?: string; recommendedNodeId?: string; ranked?: R[]; weights?: Record<string, number>; excludedByIncident?: string[] }

export default function NodeRecommendations() {
  const q = useQuery({ queryKey: ['node-rec'], queryFn: () => get<Data>('/node-recommendations'), refetchInterval: 60_000 });
  if (q.isLoading) return <div className="space-y-3"><PageTitle title="Подбор локации" /><Sk className="h-40" /></div>;
  if (q.isError) return <div className="space-y-3"><PageTitle title="Подбор локации" /><Empty title="Не удалось загрузить" text={q.error instanceof ApiError ? q.error.message : 'Ошибка'} /></div>;
  const d = q.data!;
  return (
    <div className="space-y-5">
      <PageTitle title="Подбор локации" subtitle="Как модель оценивает локации по реальным замерам Xray. Только просмотр: ничего не переключается." />
      {!d.enabled ? <Card className="p-4 text-sm text-muted">Модуль выключен (NODE_RECOMMENDATIONS_ENABLED=false).</Card> : (
        <>
          <Section title="Рейтинг сейчас">
            {!d.ranked?.length ? <Empty title="Нет локаций" text="Добавьте видимые локации в «Статус серверов»." /> : (
              <div className="space-y-2">{d.ranked.map((r) => (
                <div key={r.nodeId} className="flex flex-wrap items-center gap-2 rounded-2xl border border-fg/10 p-3 text-sm">
                  <StatusPill tone={r.quality === 'high' ? 'ok' : r.quality === 'medium' ? 'warn' : 'unknown'}>{r.quality === 'high' ? 'Высокое' : r.quality === 'medium' ? 'Среднее' : 'Мало данных'}</StatusPill>
                  <b>{r.label}</b>{r.nodeId === d.recommendedNodeId && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs">рекомендуем</span>}
                  <span className="text-muted">оценка {r.score ?? '—'} · замеров {r.evidenceCount} · {r.checkedAt ? fmtDateTime(r.checkedAt) : 'не проверялась'}</span>
                  <span className="basis-full text-xs text-muted">{r.reasons.join(' · ')}</span>
                </div>))}</div>
            )}
            {!!d.excludedByIncident?.length && <p className="mt-2 text-xs text-danger">Исключены из-за подтверждённого инцидента: {d.excludedByIncident.join(', ')}</p>}
            <p className="mt-2 text-xs text-muted">Веса — стартовая гипотеза: {Object.entries(d.weights ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}. «Нагрузка» пока нейтральна (данных нет).</p>
          </Section>
        </>
      )}
    </div>
  );
}

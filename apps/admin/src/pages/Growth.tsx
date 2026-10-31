import { Card } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { Field, Input } from '@vpn/ui';
import { GroupForm, Toggle } from '../components/GroupForm';
import { Empty, PageTitle, Section, Sk } from '../components/kit';
import { get } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../lib/auth';

interface Stats { funnel: { step: string; sent: number; lastAt: string }[]; autoCampaigns: { key: string; title: string; pct: number; audience: string; active: boolean }[] }
const STEP: Record<string, string> = { start_nudge: 'Напоминание тем, кто не подключился', trial_tips: 'Совет в конце первого дня пробного периода', trial_ended: 'После окончания пробного периода' };
const num = (set: (k: string, v: unknown) => void, k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === '' ? 0 : Number(e.target.value));

export default function Growth() {
  const { can } = useAuth();
  const canEdit = can('admin');
  const st = useQuery({ queryKey: ['growth-stats'], queryFn: () => get<Stats>('/growth/stats'), refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: Record<string, any> }>('/settings') });
  return (
    <div className="space-y-5">
      <PageTitle title="Рост: скидки и воронка" subtitle="Автоматические скидки на продление и сообщения бота новым пользователям. Всё выключено, пока вы не включите." />
      {cfg.isLoading ? <Sk className="h-40" /> : (
        <>
          <GroupForm group="autodiscount" data={cfg.data?.settings.autodiscount} title="Автоматические скидки" description="Работают через обычные акции: платёжный код не затрагивается. Скидка видна пользователю на странице тарифов." locked={!canEdit}>
            {(v, set) => (<div className="space-y-3">
              <Toggle label="Включить автоскидки" checked={!!v.enabled} onChange={(x) => set('enabled', x)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Скидка, если подписка скоро закончится, %"><Input type="number" min={0} max={90} value={v.expiring_pct} onChange={num(set, 'expiring_pct')} /></Field>
                <Field label="За сколько дней до конца"><Input type="number" min={1} max={30} value={v.expiring_days} onChange={num(set, 'expiring_days')} /></Field>
                <Field label="Скидка тем, у кого подписка закончилась, %"><Input type="number" min={0} max={90} value={v.expired_pct} onChange={num(set, 'expired_pct')} /></Field>
                <Field label="Сколько дней после окончания"><Input type="number" min={1} max={90} value={v.expired_days} onChange={num(set, 'expired_days')} /></Field>
              </div>
              <p className="text-xs text-muted">Скидка 0% выключает соответствующую акцию. Изменения применяются в течение 10 минут.</p>
            </div>)}
          </GroupForm>
          <GroupForm group="funnel" data={cfg.data?.settings.funnel} title="Воронка в боте" description="Короткие сообщения с кнопкой «Открыть приложение». Каждый шаг уходит человеку не больше одного раза; заблокировавшим бота не пишем." locked={!canEdit}>
            {(v, set) => (<div className="space-y-3">
              <Toggle label="Включить воронку" checked={!!v.enabled} onChange={(x) => set('enabled', x)} />
              <Field label="Через сколько часов напомнить, если не подключился"><Input type="number" min={1} max={72} value={v.start_nudge_hours} onChange={num(set, 'start_nudge_hours')} /></Field>
              <Toggle label="Совет во время пробного периода" checked={!!v.trial_tips} onChange={(x) => set('trial_tips', x)} />
              <Toggle label="Предложение после пробного периода" hint="Упоминает автоскидку, если она включена" checked={!!v.trial_ended_offer} onChange={(x) => set('trial_ended_offer', x)} />
            </div>)}
          </GroupForm>
        </>
      )}
      <Section title="Что уже отправлено (30 дней)">
        {st.isLoading ? <Sk className="h-24" /> : !st.data?.funnel.length ? <Empty title="Пока ничего" text="После включения воронки здесь появится статистика." /> : (
          <div className="space-y-2">{st.data.funnel.map((f) => <Card key={f.step} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span>{STEP[f.step] ?? f.step}</span><span className="text-muted">отправлено {f.sent} · последнее {fmtDateTime(f.lastAt)}</span></Card>)}</div>
        )}
        {!!st.data?.autoCampaigns.length && <div className="mt-3 space-y-2">{st.data.autoCampaigns.map((c) => <Card key={c.key} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span>{c.title}</span><span className="text-muted">{c.pct}% · {c.active ? 'действует' : 'выключена'}</span></Card>)}</div>}
      </Section>
    </div>
  );
}

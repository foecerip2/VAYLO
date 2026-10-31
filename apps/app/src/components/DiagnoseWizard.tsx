import { Button, Card } from '@vpn/ui';
import { AlertTriangle, CheckCircle2, CircleHelp, HeartPulse, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText, get } from '../lib/api';

type Tone = 'ok' | 'warn' | 'bad' | 'unknown';
interface Diag { operatorLabel: string | null; steps: { id: string; tone: Tone; title: string; hint: string }[]; recommendedLabel: string | null; verdict: 'service' | 'operator' | 'subscription' | 'unknown'; ticketDraft: string }

const ICON: Record<Tone, JSX.Element> = {
  ok: <CheckCircle2 className="h-5 w-5 text-success" />, warn: <AlertTriangle className="h-5 w-5 text-warning" />,
  bad: <XCircle className="h-5 w-5 text-danger" />, unknown: <CircleHelp className="h-5 w-5 text-muted" />,
};
const VERDICT: Record<Diag['verdict'], string> = {
  subscription: 'Причина — в подписке. Продлите тариф, и всё заработает.',
  service: 'Часть серверов сейчас недоступна — это не ваша вина. Мы уже видим проблему; попробуйте другую локацию.',
  operator: 'Похоже, у вашего оператора сейчас проблемы с доступом. Переключитесь на Wi-Fi или другую локацию.',
  unknown: 'Явной причины не нашли. Попробуйте шаги ниже, а если не поможет — напишите нам: данные уже подготовлены.',
};

/** Мастер «Не работает»: проверяет подписку, серверы и сеть оператора — без ключей и ссылок в ответе. */
export function DiagnoseWizard() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [d, setD] = useState<Diag | null>(null); const [err, setErr] = useState('');
  const run = async () => { setState('busy'); try { setD(await get<Diag>('/diagnose')); setState('done'); } catch (e) { setErr(errorText(e, 'Не удалось проверить')); setState('error'); } };
  return <Card className="orbit-diagnose space-y-4 p-5">
    <div className="flex items-center gap-3"><span className="orbit-diagnose-icon"><HeartPulse className="h-6 w-6" /></span><div><h2 className="text-lg font-bold tracking-tight">Не работает?</h2><p className="text-xs text-muted">Проверим подписку, серверы и вашу сеть за несколько секунд</p></div></div>
    {state !== 'done' && <Button full onClick={run} disabled={state === 'busy'}>{state === 'busy' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Проверяем…</> : 'Проверить автоматически'}</Button>}
    {state === 'error' && <p role="alert" className="text-sm text-danger">{err}</p>}
    {state === 'done' && d && <div className="space-y-3" aria-live="polite">
      <ul className="space-y-2">{d.steps.map((s) => <li key={s.id} className="flex gap-3 text-sm">{ICON[s.tone]}<div><b>{s.title}</b>{s.hint && <p className="text-xs text-muted">{s.hint}</p>}</div></li>)}</ul>
      {d.recommendedLabel && <p className="text-sm">Лучше всего сейчас работает: <b>{d.recommendedLabel}</b></p>}
      <p className="rounded-xl bg-primary/10 p-3 text-sm leading-relaxed">{VERDICT[d.verdict]}</p>
      <div className="flex flex-wrap gap-2">
        {d.verdict === 'subscription' ? <Link to="/plans" className="flex-1"><Button full>Выбрать тариф</Button></Link> : <Link to={`/support?diagnostic=${encodeURIComponent(d.ticketDraft)}`} className="flex-1"><Button full>В поддержку</Button></Link>}
        <Button variant="ghost" onClick={run}>Проверить ещё раз</Button>
      </div>
    </div>}
  </Card>;
}

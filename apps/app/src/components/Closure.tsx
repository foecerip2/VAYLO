import { Button, Card, Logo } from '@vpn/ui';
import { Hourglass } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useConfig, useMe } from '../lib/queries';
import { openExternal } from '../lib/tg';
import '../closure-fx.css';

export interface ClosureInfo { active: true; endsAt: string | null; serverNow: string; reason: string; altText: string; altUrl: string }

/** Таймер до закрытия. Время считается по часам сервера (поправка на неверные часы телефона), обновляется раз в секунду. */
export function useClosure(): { info: ClosureInfo | null; msLeft: number | null } {
  const cfg = useConfig();
  const c = cfg.data?.closure;
  const info = c && c.active ? (c as ClosureInfo) : null;
  const [offset, setOffset] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (info) setOffset(new Date(info.serverNow).getTime() - Date.now()); }, [info?.serverNow]);
  useEffect(() => { if (!info) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [!!info]);
  if (!info) return { info: null, msLeft: null };
  return { info, msLeft: info.endsAt ? Math.max(0, new Date(info.endsAt).getTime() - (Date.now() + offset)) : null };
}

const pad = (n: number) => String(n).padStart(2, '0');
export function Countdown({ ms, big }: { ms: number; big?: boolean }) {
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  const cells: [string, string][] = [[String(d), 'дн'], [pad(h), 'ч'], [pad(m), 'мин'], [pad(s), 'сек']];
  return <div role="timer" aria-label={`До закрытия: ${d} дн ${h} ч ${m} мин`} className={`grid grid-cols-4 gap-2 text-center ${big ? '' : 'w-64 max-w-full'}`}>
    {cells.map(([v, u]) => <div key={u} className="rounded-2xl border border-fg/10 bg-fg/5 py-2"><div className={`${big ? 'text-3xl' : 'text-xl'} font-extrabold tabular-nums leading-none`}>{v}</div><div className="mt-1 text-[11px] uppercase tracking-wide text-muted">{u}</div></div>)}
  </div>;
}

function AltLink({ info }: { info: ClosureInfo }) {
  if (!info.altText && !info.altUrl) return null;
  return <div className="space-y-2 text-sm">{info.altText && <p className="text-muted">{info.altText}</p>}{/^https?:\/\//.test(info.altUrl) && <Button size="sm" variant="ghost" onClick={() => openExternal(info.altUrl)}>Подробнее</Button>}</div>;
}


/** Декор: трещины и осыпающиеся страницы. Не интерактивный и скрыт от скринридеров. */
function CrashFx() {
  return <div className="closure-fx" aria-hidden="true">
    <svg className="closure-crack" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path pathLength="1" d="M0 12 L14 22 L10 34 L24 46 L19 60 L33 72 L28 100" vectorEffect="non-scaling-stroke" />
      <path pathLength="1" d="M100 6 L84 20 L89 33 L72 44 L78 58 L62 70 L66 100" vectorEffect="non-scaling-stroke" />
      <path pathLength="1" d="M14 22 L30 19 L38 28" vectorEffect="non-scaling-stroke" />
      <path pathLength="1" d="M84 20 L70 14 L64 24" vectorEffect="non-scaling-stroke" />
    </svg>
    {Array.from({ length: 7 }, (_, i) => <span key={`p${i}`} className="closure-page" />)}
    {Array.from({ length: 3 }, (_, i) => <span key={`s${i}`} className="closure-shard" />)}
  </div>;
}

/** Плашка с таймером: компактная на всех страницах, развёрнутая (full) — на главной. */
export function ClosureBanner({ full }: { full?: boolean }) {
  const { info, msLeft } = useClosure();
  const me = useMe();
  if (!info) return null;
  const exp = me.data?.subscription?.expiresAt;
  const mine = me.data?.subscription && !['none', 'expired'].includes(me.data.subscription.state) && exp ? new Date(exp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;
  return <Card className="closure-card border-warning/40 bg-warning/10 p-4" role="status">
    <CrashFx />
    <div className="closure-body space-y-3">
    <div className="closure-title flex items-center gap-2 font-bold"><span className="closure-hourglass"><Hourglass className="h-5 w-5 text-warning" /></span>Проект закрывается 😢</div>
    {msLeft !== null ? (msLeft > 0 ? <Countdown ms={msLeft} big={full} /> : <p className="text-sm font-semibold">Срок закрытия наступил.</p>) : null}
    {full && <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{info.reason}</p>}
    <p className="text-xs text-muted">🚫 Продажи и регистрация закрыты.{mine ? ` 💙 Ваша подписка работает до ${mine} и не слетит.` : ''}</p>
    {full && <AltLink info={info} />}
    </div>
  </Card>;
}

/** Страницы покупок и наград недоступны, пока проект закрывается. */
export function ClosedGuard({ children }: { children: ReactNode }) {
  const { info, msLeft } = useClosure();
  if (!info) return <>{children}</>;
  return <div className="mx-auto max-w-md space-y-4 pt-6 text-center">
    <h1 className="text-2xl font-extrabold tracking-tight">Продажи закрыты 😔</h1>
    <p className="text-sm leading-relaxed text-muted">К сожалению, проект закрывается, поэтому покупки, пополнения, пробный период, промокоды и награды недоступны 💔 Действующие подписки работают до окончания срока.</p>
    {msLeft !== null && msLeft > 0 && <div className="flex justify-center"><Countdown ms={msLeft} /></div>}
    <AltLink info={info} />
  </div>;
}

/** Экран для нового пользователя, которого не пускают из-за закрытой регистрации. */
export function RegistrationClosed() {
  const { info, msLeft } = useClosure();
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
    <Logo />
    <Card className="max-w-sm space-y-4 p-6">
      <h1 className="text-lg font-bold">Регистрация закрыта 😔</h1>
      <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{info?.reason ?? 'Проект закрывается, новые пользователи не принимаются.'}</p>
      {msLeft !== null && msLeft > 0 && <div className="flex justify-center"><Countdown ms={msLeft} /></div>}
      {info && <AltLink info={info} />}
    </Card>
  </div>;
}

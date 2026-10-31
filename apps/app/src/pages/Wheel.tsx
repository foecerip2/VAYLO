import { Button, Card, ErrorState, Sheet, Skeleton, useToast } from '@vpn/ui';
import type { WheelSpinResultDTO } from '@vpn/shared';
import { formatRub, pluralDays } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Disc3 } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CssWheel from '../components/CssWheel';
import { PageHeader } from '../components/Layout';
import { ApiError, errorText, post } from '../lib/api';
import { useRefreshAfterPayment, useWheel } from '../lib/queries';
import { haptic } from '../lib/tg';
import { WheelLazy, burst, has3D, type WheelHandle } from '../three/lazy';

const prizeText = (p: { type: 'days' | 'balance'; value: number }) => (p.type === 'days' ? `+${p.value} ${pluralDays(p.value)} подписки` : `+${formatRub(p.value)} на баланс`);

function useCountdown(iso: string | null) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!iso) return setLeft(0);
    const tick = () => setLeft(Math.max(0, new Date(iso).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  const s = Math.floor(left / 1000);
  return { left, text: `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` };
}

export default function Wheel() {
  const w = useWheel();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefreshAfterPayment();
  const ref = useRef<WheelHandle>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelSpinResultDTO['prize'] | null>(null);
  const labels = useMemo(() => w.data?.prizes.map((p) => p.label) ?? [], [w.data?.prizes]);
  const cd = useCountdown(w.data && !w.data.canSpin ? w.data.nextSpinAt : null);

  // Время вышло, а сервер ещё отвечает «нельзя» (часы телефона спешат / приложение было в фоне) — опрашиваем каждые 3 с, пока колесо не разблокируется.
  const locked = Boolean(w.data && !w.data.canSpin);
  const nextAt = w.data?.nextSpinAt ?? null;
  useEffect(() => {
    if (!locked || !nextAt) return;
    const check = () => { if (Date.now() >= new Date(nextAt).getTime() - 1000) void qc.refetchQueries({ queryKey: ['wheel'] }); };
    const id = setInterval(check, 3000);
    check();
    return () => clearInterval(id);
  }, [locked, nextAt, qc]);
  // Вернулись в приложение из фона (прошли сутки) — сразу обновляем состояние.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void qc.refetchQueries({ queryKey: ['wheel'] }); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [qc]);

  async function spin() {
    if (spinning || !w.data?.canSpin) return;
    setSpinning(true);
    haptic('light');
    try {
      // приз определяет сервер; анимация лишь показывает уже выпавший сектор
      const r = await post<WheelSpinResultDTO>('/wheel/spin');
      await ref.current?.spinTo(r.prizeIndex, () => haptic('light'));
      haptic('success');
      burst();
      setResult(r.prize);
      refresh();
      await qc.invalidateQueries({ queryKey: ['wheel'] });
    } catch (e) {
      haptic('error');
      toast(e instanceof ApiError ? e.message : errorText(e), 'error');
      await qc.invalidateQueries({ queryKey: ['wheel'] });
    } finally {
      setSpinning(false);
    }
  }

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Колесо удачи" subtitle="Один бесплатный прокрут каждый день — дни подписки и деньги на баланс" />
      {w.isLoading ? (
        <Skeleton className="h-[420px] w-full !rounded-card" />
      ) : w.isError ? (
        <ErrorState message={errorText(w.error)} onRetry={() => w.refetch()} />
      ) : !w.data?.enabled ? (
        <Card className="p-6 text-center text-sm text-muted">Колесо удачи сейчас отключено. Загляните позже.</Card>
      ) : (
        <>
          <Card className="overflow-hidden !rounded-[28px] p-3">
            {has3D() ? <Suspense fallback={<div className="h-[320px]" />}><WheelLazy ref={ref} labels={labels} /></Suspense> : <CssWheel ref={ref} labels={labels} />}
            <div className="px-2 pb-2 pt-1">
              <button className="power-btn" disabled={spinning || !w.data.canSpin} onClick={spin}>
                <span className="pulse" />
                <Disc3 className={`h-6 w-6 ${spinning ? 'animate-spin' : ''}`} />
                <span className="relative whitespace-nowrap text-[15px]">{spinning ? 'Крутим…' : w.data.canSpin ? 'Крутить колесо' : `Снова через ${cd.text}`}</span>
              </button>
              {!w.data.canSpin && <p className="mt-3 text-center text-xs text-muted">Колесо обновляется каждый день в полночь по Москве.</p>}
              {w.data.last && w.data.canSpin && <p className="mt-3 text-center text-xs text-muted">В прошлый раз выпало: {prizeText(w.data.last)}</p>}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 font-display text-sm font-bold">Что можно выиграть</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {w.data.prizes.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface-2/60 px-3 py-2">
                  <span className={`h-2 w-2 rounded-full ${p.type === 'days' ? 'bg-primary' : 'bg-success'}`} />
                  <span className="font-semibold">{prizeText(p)}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Выигрыш зачисляется сразу. Больше призов — в <Link to="/quests" className="font-semibold text-primary">заданиях</Link>.</p>
          </Card>
        </>
      )}

      <Sheet open={Boolean(result)} onClose={() => setResult(null)} title="Ваш выигрыш">
        {result && (
          <div className="space-y-4 pb-2 text-center">
            <div className="css-coin"><i>{result.type === 'days' ? '★' : '₽'}</i></div>
            <div className="font-display text-2xl font-extrabold">{prizeText(result)}</div>
            <p className="text-sm text-muted">Награда уже начислена. Возвращайтесь завтра за новым призом!</p>
            <Button full onClick={() => setResult(null)}>Отлично</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

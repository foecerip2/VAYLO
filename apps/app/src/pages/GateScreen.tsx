import { Button, Card, Logo, useToast } from '@vpn/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { GateDTO } from '@vpn/shared';
import { CheckCircle2, Megaphone } from 'lucide-react';
import { useState } from 'react';
import { ApiError, post } from '../lib/api';
import { haptic, openExternal } from '../lib/tg';

/** Жёсткий барьер: доступ к приложению только после подписки на канал(ы) */
export default function GateScreen({ gate, brand }: { gate: GateDTO; brand: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try {
      const g = await post<GateDTO>('/gate/check');
      if (g.ok) {
        haptic('success');
        await qc.invalidateQueries();
      } else {
        haptic('error');
        toast('Подписка не найдена. Подпишитесь на канал и нажмите снова.', 'error');
        await qc.invalidateQueries({ queryKey: ['me'] });
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo name={brand} />
      <Card className="w-full max-w-sm animate-fade-up space-y-5 p-6">
        <div className="hero-bg mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-glow"><Megaphone className="h-8 w-8" /></div>
        <div>
          <h1 className="text-xl font-bold">Подпишитесь на канал</h1>
          <p className="mt-2 text-sm text-muted">{gate.text}</p>
        </div>
        <div className="space-y-2">
          {gate.chats.map((c) => (
            <button key={c.chat} onClick={() => c.url && openExternal(c.url)} className="flex w-full items-center gap-3 rounded-btn border border-border p-3.5 text-left transition hover:border-primary/50">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary"><Megaphone className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.title}</div><div className="text-xs text-muted">{c.joined ? 'Вы подписаны' : 'Нажмите, чтобы открыть'}</div></div>
              {c.joined && <CheckCircle2 className="h-5 w-5 text-success" />}
            </button>
          ))}
        </div>
        <Button full size="lg" loading={busy} onClick={check}>Я подписался</Button>
      </Card>
    </div>
  );
}

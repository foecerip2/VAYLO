import { Card } from '@vpn/ui';
import { ArrowUpRight, Gift, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/queries';
import { openExternal } from '../lib/tg';
import { readPendingGift } from '../lib/gift-links';

/** No unauthenticated lookup: the gift is revealed only after the recipient signs in. */
export default function GiftGuest() {
  const cfg = useConfig();
  const pending = readPendingGift();
  const brand = cfg.data?.brandName ?? 'VAYLO';
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-5">
    <div className="orbit-wordmark text-center">{brand}</div>
    <section className="gift-welcome text-center">
      <div className="gift-welcome-icon"><Gift className="h-10 w-10" /></div>
      <p className="orbit-kicker mb-3">Немного свободы для вас</p>
      <h1 className="text-3xl font-extrabold tracking-tight">{pending ? 'Вас ждёт подарок' : 'Подписка с тёплыми словами'}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">{pending ? 'Войдите через Telegram, чтобы прочитать поздравление и посмотреть условия подарка.' : 'Войдите, чтобы подарить подписку или активировать полученный код.'}</p>
      <Link className="orbit-cta mt-6" to="/login?next=%2Fgifts%3Freceive%3D1">Войти и открыть<ArrowUpRight className="h-5 w-5" /></Link>
      {pending && cfg.data?.botUsername && <button className="mt-4 text-sm font-bold text-primary" onClick={() => openExternal(`https://t.me/${(cfg.data?.botUsername ?? '').replace(/^@/, '')}?start=gift_${pending}`)}>Открыть подарок в Telegram →</button>}
    </section>
    <Card className="flex items-start gap-3 p-4"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-xs leading-relaxed text-muted">Открытие ссылки не активирует подарок. После входа вы увидите открытку и сами подтвердите получение.</p></Card>
    <Link to="/" className="text-center text-sm text-muted">На главную</Link>
  </main>;
}

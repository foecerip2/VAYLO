import { Button, Card, Logo, Spinner } from '@vpn/ui';
import { formatRub, type PaymentDTO } from '@vpn/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Send, Undo2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useConfig, useRefreshAfterPayment } from '../lib/queries';
import { haptic, openExternal } from '../lib/tg';

type Status = PaymentDTO & { gift?: boolean; fulfilled: boolean; payUrl: string | null; fulfillFailed?: boolean; refundedToBalance?: boolean };

/** Через сколько без изменений показываем «обрабатывается дольше обычного» */
const STUCK_AFTER_MS = 2 * 60_000;

const isFinal = (d: Status) => d.status === 'canceled' || d.status === 'expired' || d.status === 'refunded' || Boolean(d.fulfillFailed) || (d.status === 'succeeded' && d.fulfilled);

const supportHref = (url?: string) => (url && /^(https?:\/\/|tg:\/\/)/.test(url) ? url : null);

function SupportButton({ className }: { className?: string }) {
  const cfg = useConfig();
  const href = supportHref(cfg.data?.supportUrl);
  if (!href) return cfg.data?.supportUrl ? <p className="mt-3 text-sm text-muted">Поддержка: {cfg.data.supportUrl}</p> : null;
  return <Button className={className} full onClick={() => openExternal(href)}>Написать в поддержку</Button>;
}

export default function PaymentStatus() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const refresh = useRefreshAfterPayment();
  const [stuck, setStuck] = useState(false);
  const q = useQuery({
    queryKey: ['payment', id],
    queryFn: () => get<Status>(`/payments/${id}`),
    refetchInterval: (query) => {
      const d = query.state.data as Status | undefined;
      if (d && isFinal(d)) return false;
      return stuck ? 10_000 : 3000;
    },
  });
  const p = q.data;
  const done = p?.status === 'succeeded' && p.fulfilled;
  const final = p ? isFinal(p) : false;

  // «зависание»: статус не меняется ~2 минуты
  const sig = p ? `${p.status}:${p.fulfilled}:${p.fulfillFailed ?? ''}` : '';
  const since = useRef({ sig: '', at: Date.now() });
  useEffect(() => {
    if (sig !== since.current.sig) {
      since.current = { sig, at: Date.now() };
      setStuck(false);
    }
  }, [sig]);
  useEffect(() => {
    if (final || !p) return;
    const t = setInterval(() => {
      if (Date.now() - since.current.at >= STUCK_AFTER_MS) setStuck(true);
    }, 5000);
    return () => clearInterval(t);
  }, [final, p]);

  useEffect(() => {
    if (done) {
      haptic('success');
      refresh();
    }
    if (p?.fulfillFailed || p?.status === 'refunded') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, p?.fulfillFailed, p?.status]);

  const failed = p?.status === 'canceled' || p?.status === 'expired' || (sp.get('failed') === '1' && p?.status !== 'succeeded');

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md items-center">
      <Card className="w-full animate-fade-up p-8 text-center">
        {q.isError && !p ? (
          <>
            <XCircle className="mx-auto h-16 w-16 text-danger" />
            <h1 className="mt-4 text-xl font-bold">Не удалось проверить платёж</h1><p className="mt-2 text-sm text-muted">Проверьте соединение и повторите запрос.</p><Button className="mt-4" full onClick={() => void q.refetch()}>Повторить</Button>
            <Link to="/"><Button className="mt-6" full>На главную</Button></Link>
          </>
        ) : !p ? (
          <Spinner className="mx-auto h-8 w-8" />
        ) : done ? (
          <>
            <div className="relative mx-auto h-20 w-20"><span className="absolute inset-0 animate-pulse-ring rounded-full bg-success/30" /><CheckCircle2 className="relative h-20 w-20 text-success" /></div>
            <h1 className="mt-5 text-2xl font-bold">Оплата прошла!</h1>
            <p className="mt-2 text-muted">{p.gift ? 'Подарок готов. Код активации — в разделе «Подарки».' : p.purpose === 'plan' ? `Тариф «${p.planName}» активирован.` : p.purpose === 'addon' ? `Докупка «${p.planName}» применена.` : `Баланс пополнен на ${formatRub(p.amount)}.`}</p>
            <div className="mt-6 flex flex-col gap-2">
              {p.gift && <Link to="/gifts"><Button full size="lg">Открыть подарок</Button></Link>}
              {!p.gift && p.purpose === 'plan' && <Link to="/connect"><Button full size="lg">Подключиться</Button></Link>}
              <Link to="/"><Button full variant="secondary">На главную</Button></Link>
            </div>
          </>
        ) : p.fulfillFailed ? (
          <>
            <AlertTriangle className="mx-auto h-16 w-16 text-warning" />
            <h1 className="mt-4 text-xl font-bold">Оплата получена, но доступ не выдан</h1>
            <p className="mt-2 text-sm text-muted">
              {p.refundedToBalance
                ? `Мы не смогли автоматически оформить покупку, поэтому вернули ${formatRub(p.amount)} на ваш баланс — его можно потратить на тариф или докупку.`
                : 'Мы не смогли автоматически оформить покупку. Деньги не потеряются — напишите в поддержку, и мы всё решим.'}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {p.refundedToBalance && <Link to="/wallet"><Button full>Открыть баланс</Button></Link>}
              <SupportButton />
              <Link to="/"><Button full variant="ghost">На главную</Button></Link>
            </div>
          </>
        ) : p.status === 'refunded' ? (
          <>
            <Undo2 className="mx-auto h-16 w-16 text-primary" />
            <h1 className="mt-4 text-xl font-bold">Платёж возвращён</h1>
            <p className="mt-2 text-sm text-muted">Деньги по этому платежу возвращены. Если остались вопросы — напишите в поддержку.</p>
            <div className="mt-6 flex flex-col gap-2">
              <SupportButton />
              <Link to="/"><Button full variant="ghost">На главную</Button></Link>
            </div>
          </>
        ) : failed ? (
          <>
            <XCircle className="mx-auto h-16 w-16 text-danger" />
            <h1 className="mt-4 text-xl font-bold">Платёж не завершён</h1>
            <p className="mt-2 text-sm text-muted">Оплата была отменена или не прошла. Если деньги списались, дождитесь обновления статуса или напишите в поддержку.</p>
            <Link to="/"><Button className="mt-6" full>На главную</Button></Link>
          </>
        ) : stuck ? (
          <>
            <Clock className="mx-auto h-14 w-14 text-warning" />
            <h1 className="mt-4 text-xl font-bold">Платёж обрабатывается дольше обычного</h1>
            <p className="mt-2 text-sm text-muted">
              {p.status === 'succeeded'
                ? 'Оплата получена, но доступ ещё не активирован. Напишите в поддержку — мы проверим платёж вручную.'
                : 'Платёж обрабатывается дольше обычного — напишите в поддержку. Если вы ещё не оплатили, откройте страницу оплаты.'}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <SupportButton />
              {p.status === 'pending' && p.payUrl && <Button full variant="secondary" onClick={() => openExternal(p.payUrl!)}>Открыть страницу оплаты</Button>}
              <Link to="/"><Button full variant="ghost">На главную</Button></Link>
            </div>
          </>
        ) : p.status === 'succeeded' ? (
          <>
            <Spinner className="mx-auto h-10 w-10" />
            <h1 className="mt-4 text-xl font-bold">Оплата получена</h1>
            <p className="mt-2 text-sm text-muted">Активируем доступ — это займёт несколько секунд…</p>
          </>
        ) : (
          <>
            <Clock className="mx-auto h-14 w-14 text-primary" />
            <h1 className="mt-4 text-xl font-bold">Ждём оплату</h1>
            <p className="mt-2 text-sm text-muted">Как только платёж пройдёт, доступ откроется автоматически. Страницу можно не закрывать.</p>
            {p.payUrl && <Button className="mt-6" full variant="secondary" onClick={() => openExternal(p.payUrl!)}>Открыть страницу оплаты</Button>}
            <Link to="/"><Button className="mt-2" full variant="ghost">На главную</Button></Link>
          </>
        )}
      </Card>
    </div>
  );
}

/** Возврат с платёжной страницы во внешнем браузере, где нет сессии: нейтральная страница без Landing */
export function PaymentReturnGuest() {
  const cfg = useConfig();
  const [sp] = useSearchParams();
  const failed = sp.get('failed') === '1';
  const bot = cfg.data?.botUsername;
  const botUrl = bot ? `https://t.me/${bot.replace(/^@/, '')}` : null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-5">
      <Logo name={cfg.data?.brandName ?? 'VPN'} />
      <Card className="w-full animate-fade-up p-8 text-center">
        {failed ? <XCircle className="mx-auto h-14 w-14 text-danger" /> : <Clock className="mx-auto h-14 w-14 text-primary" />}
        <h1 className="mt-4 text-xl font-bold">{failed ? 'Платёж не завершён' : 'Оплата принята в обработку'}</h1>
        <p className="mt-2 text-sm text-muted">
          {failed ? 'Оплата была отменена или не прошла. Вернитесь в Telegram и попробуйте ещё раз.' : 'Вернитесь в Telegram — доступ появится автоматически, мы пришлём уведомление.'}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {botUrl && <Button full icon={<Send className="h-4 w-4" />} onClick={() => (window.location.href = botUrl)}>Открыть бота в Telegram</Button>}
          <Link to="/login"><Button full variant="ghost">Войти на сайте</Button></Link>
        </div>
      </Card>
    </div>
  );
}

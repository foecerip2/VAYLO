import { Button, Field, Input, Sheet, Skeleton, cn, useToast } from '@vpn/ui';
import { PROMO_MAX_LENGTH, durationLabel, formatRub, type AddonProductDTO, type PaymentMethodDTO, type PlanDTO } from '@vpn/shared';
import { Check, CreditCard, Tag, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, errorText, post } from '../lib/api';
import { useMe, useMethods, useRefreshAfterPayment } from '../lib/queries';
import { haptic, openExternal } from '../lib/tg';

interface Quote { gross: number; discount: number; total: number; bonus: number; balance: number; promo: { code: string } | null }
export type PurchaseItem = { kind: 'plan'; plan: PlanDTO; gift?: boolean } | { kind: 'addon'; addon: AddonProductDTO } | null;

/** Универсальное окно оплаты: тариф или докупка. Баланс, карты/СБП/крипта, промокод (для тарифов), персональная скидка. */
export function PurchaseSheet({ item, onClose }: { item: PurchaseItem; onClose: () => void }) {
  const methods = useMethods();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefreshAfterPayment();
  const [method, setMethod] = useState('');
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [baseQuote, setBaseQuote] = useState<Quote | null>(null); // расчёт без промокода
  const [promoErr, setPromoErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const generation = useRef(0);
  const promoGeneration = useRef(0);
  const paying = useRef(false);
  const operationKey = useRef(crypto.randomUUID());

  const gift = item?.kind === 'plan' && !!item.gift;
  const key = item ? (item.kind === 'plan' ? item.plan.id : item.addon.id) : '';
  const idField = item ? (item.kind === 'plan' ? { planId: key } : { addonId: key }) : {};

  useEffect(() => {
    setPromo('');
    setPromoErr('');
    setMethod('');
    setQuote(null);
    setBaseQuote(null);
    const version = ++generation.current;
    ++promoGeneration.current;
    operationKey.current = crypto.randomUUID();
    setQuoteError('');
    setQuoting(!!item);
    if (!item) return;
    post<Quote>('/quote', idField)
      .then((q) => { if (generation.current === version) {setQuote(q); setBaseQuote(q);} })
      .catch((e) => { if (generation.current === version) setQuoteError(errorText(e, 'Не удалось рассчитать стоимость')); })
      .finally(() => {if (generation.current === version) setQuoting(false);});
    return () => { ++generation.current; ++promoGeneration.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, item?.kind, gift]);

  const base = item ? (item.kind === 'plan' ? item.plan.price : item.addon.price) : 0;
  const total = quote?.total ?? base;
  const balance = me.data?.balance ?? 0;
  const list: PaymentMethodDTO[] = [
    ...(balance >= total && total > 0 ? [{ id: 'balance', provider: 'balance' as const, title: 'С баланса', hint: `Доступно ${formatRub(balance)}` }] : []),
    ...(methods.data ?? []),
  ];
  const chosen = total === 0 ? 'balance' : method || list[0]?.id || '';
  useEffect(() => { operationKey.current = crypto.randomUUID(); }, [chosen, quote?.promo?.code]);

  async function applyPromo() {
    if (!promo.trim() || item?.kind !== 'plan') return;
    setPromoErr('');
    const version = generation.current;
    const promoVersion = ++promoGeneration.current;
    setQuoting(true);
    try {
      const result = await post<Quote>('/quote', { planId: key, promo: promo.trim() });
      if (version !== generation.current || promoVersion !== promoGeneration.current) return;
      setQuote(result);
      haptic('success');
    } catch (e) {
      if (version !== generation.current || promoVersion !== promoGeneration.current) return;
      setPromoErr(e instanceof ApiError ? e.message : 'Ошибка');
      haptic('error');
    } finally { if (version === generation.current && promoVersion === promoGeneration.current) setQuoting(false); }
  }

  async function pay() {
    if (!item || paying.current || quoting || !quote || quoteError) return;
    paying.current = true;
    setBusy(true);
    try {
      const r = await post<{ id: string; status: string; payUrl: string | null }>('/payments', { ...idField, method: chosen, promo: quote?.promo ? promo.trim() : undefined, ...(gift ? {gift: true} : {}) }, operationKey.current);
      onClose();
      refresh();
      if (r.status === 'succeeded') {
        haptic('success');
        toast(gift ? 'Подарок готов 🎁' : item.kind === 'plan' ? 'Тариф оформлен 🎉' : 'Докупка применена ✅', 'success');
        nav(gift ? '/gifts' : item.kind === 'plan' ? '/connect' : '/');
      } else {
        nav(`/payment/${r.id}`);
        if (r.payUrl) openExternal(r.payUrl);
      }
    } catch (e) {
      haptic('error');
      toast(e instanceof ApiError ? e.message : 'Не удалось создать платёж', 'error');
    } finally {
      paying.current = false;
      setBusy(false);
    }
  }

  const title = item ? (item.kind === 'plan' ? `${gift ? 'Подарок' : 'Тариф'} «${item.plan.name}»` : item.addon.name) : '';
  const sub = item ? (item.kind === 'plan' ? durationLabel(item.plan.durationDays) : item.addon.description || (item.addon.kind === 'devices' ? `+${item.addon.qty} устройств` : item.addon.kind === 'traffic' ? `+${item.addon.qty} ГБ трафика` : item.addon.durationDays ? `Доступ на ${durationLabel(item.addon.durationDays)}` : 'Доступ на время подписки')) : '';

  return (
    <Sheet open={Boolean(item)} onClose={onClose} title={title}>
      {item && (
        <div className="space-y-5">
          <div className="flex items-end justify-between rounded-btn bg-surface-2 p-4">
            <div>
              <div className="text-sm text-muted">{sub}</div>
              <div className="num text-3xl font-bold">{formatRub(total)}</div>
            </div>
            {quote && quote.discount > 0 && <div className="text-right text-sm"><div className="text-muted line-through">{formatRub(quote.gross)}</div><div className="font-medium text-success">−{formatRub(quote.discount)}</div></div>}
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Способ оплаты</div>
            {methods.isError && (
              <div className="mb-2 rounded-btn border border-danger/40 bg-danger/10 p-4 text-sm">
                Не удалось загрузить способы оплаты. Проверьте интернет и попробуйте ещё раз.
                <Button className="mt-3" size="sm" variant="secondary" loading={methods.isFetching} onClick={() => void methods.refetch()}>Повторить</Button>
              </div>
            )}
            {methods.isLoading ? <Skeleton className="h-14 w-full" /> : list.length === 0 ? (
              methods.isError ? null : <div className="rounded-btn border border-warning/40 bg-warning/10 p-4 text-sm">Оплата пока недоступна: администратор не подключил способы оплаты.</div>
            ) : (
              <div className="space-y-2">
                {list.map((m) => (
                  <button key={m.id} onClick={() => setMethod(m.id)} className={cn('flex w-full items-center gap-3 rounded-btn border p-3.5 text-left transition', chosen === m.id ? 'border-primary bg-primary/8' : 'border-border hover:border-primary/40')}>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-primary">{m.provider === 'balance' ? <Wallet className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}</div>
                    <div className="min-w-0 flex-1"><div className="font-medium">{m.title}</div>{m.hint && <div className="text-xs text-muted">{m.hint}</div>}</div>
                    <div className={cn('flex h-5 w-5 items-center justify-center rounded-full border-2', chosen === m.id ? 'border-primary bg-primary' : 'border-border')}>{chosen === m.id && <Check className="h-3 w-3 text-white" strokeWidth={3} />}</div>
                  </button>
                ))}
              </div>
            )}
            {balance < total && balance > 0 && <p className="mt-2 text-xs text-muted">На балансе {formatRub(balance)} — можно <button className="font-medium text-primary underline" onClick={() => { onClose(); nav('/wallet'); }}>пополнить баланс</button> и оплатить с него.</p>}
          </div>

          {item.kind === 'plan' && (
            <Field label="Промокод" error={promoErr} hint={quote?.promo ? `Применён: ${quote.promo.code}` : undefined}>
              <div className="flex gap-2">
                <Input
                  value={promo}
                  maxLength={PROMO_MAX_LENGTH}
                  onChange={(e) => {
                    ++promoGeneration.current;
                    setQuoting(false);
                    setPromo(e.target.value.slice(0, PROMO_MAX_LENGTH));
                    setPromoErr('');
                    // промокод изменён после применения — сбрасываем расчёт со скидкой, чтобы не оплатить по старому коду
                    if (quote?.promo) setQuote(baseQuote);
                  }}
                  placeholder="Есть промокод?"
                  autoCapitalize="characters"
                />
                <Button variant="secondary" onClick={applyPromo} icon={<Tag className="h-4 w-4" />} disabled={!promo.trim() || quoting || busy || !baseQuote}>OK</Button>
              </div>
            </Field>
          )}

          {quoteError && <p role="alert" className="text-sm text-danger">{quoteError} Закройте окно и попробуйте снова.</p>}
          <Button full size="lg" loading={busy || quoting} disabled={!chosen || !quote || !!quoteError || quoting} onClick={pay}>{total === 0 ? 'Активировать бесплатно' : `Оплатить ${formatRub(total)}`}</Button>
          <p className="text-center text-xs text-muted">{gift ? 'После оплаты получите одноразовый код. Доступ начнётся при активации подарка.' : item.kind === 'plan' ? 'Доступ откроется автоматически сразу после оплаты' : 'Изменения применятся сразу, переподключаться не нужно'}</p>
        </div>
      )}
    </Sheet>
  );
}

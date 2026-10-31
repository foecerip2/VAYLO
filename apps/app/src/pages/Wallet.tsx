import { Badge, Button, Card, EmptyState, Field, Input, Sheet, Skeleton, Switch, cn, useToast } from '@vpn/ui';
import { MAX_TOPUP_KOPECKS, formatRub, type PaymentMethodDTO } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CreditCard, Gift, PlusCircle, RefreshCcw, Wallet as WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { PromoBanner } from '../components/PromoBanner';
import { ApiError, post } from '../lib/api';
import { useCampaigns, useConfig, useMe, useMethods, useSubscription, useTransactions } from '../lib/queries';
import { haptic, openExternal } from '../lib/tg';

const TYPE: Record<string, string> = { topup: 'Пополнение', bonus: 'Бонус', purchase: 'Покупка', referral: 'Реферальные', quest: 'Задание', wheel: 'Колесо удачи', manual: 'Корректировка', promo: 'Промокод' };

export default function Wallet() {
  const me = useMe();
  const cfg = useConfig();
  const campaigns = useCampaigns();
  const sub = useSubscription();
  const tx = useTransactions();
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');

  const t = cfg.data?.topup;
  const presets = t?.presets ?? [10000, 30000, 50000, 100000];
  const extraPct = Math.max(0, ...(campaigns.data ?? []).filter((c) => c.kind === 'topup_bonus').map((c) => c.value));
  const bonusFor = (a: number) => {
    const tier = [...(t?.bonuses ?? [])].sort((x, y) => y.from - x.from).find((b) => a >= b.from);
    return Math.floor((a * ((tier?.percent ?? 0) + extraPct)) / 100);
  };
  const s = sub.data ?? me.data?.subscription;
  const canAuto = cfg.data?.autoRenewEnabled && s && s.state !== 'none' && !s.isTrial;

  async function toggleAuto(v: boolean) {
    try {
      await post('/subscription/auto-renew', { enabled: v });
      await qc.invalidateQueries({ queryKey: ['subscription'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      haptic('light');
      toast(v ? 'Автопродление включено' : 'Автопродление выключено', 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
  }

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Баланс" subtitle="Пополняйте счёт и оплачивайте всё в один тап" />
      <PromoBanner kind="topup_bonus" />

      <div className="hero-bg relative overflow-hidden rounded-[24px] p-6 text-white shadow-glow">
        <div className="blob pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-center gap-2 text-sm text-white/85"><WalletIcon className="h-4 w-4" /> Ваш баланс</div>
        <div className="num relative mt-2 text-[40px] font-bold leading-none">{me.data ? formatRub(me.data.balance) : <Skeleton className="h-10 w-40" />}</div>
        {me.data && me.data.discountPct > 0 && <div className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold"><Gift className="h-3.5 w-3.5" /> Ваша скидка {me.data.discountPct}%</div>}
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Пополнить</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {presets.map((p) => {
            const b = bonusFor(p);
            return (
              <button key={p} onClick={() => { haptic('light'); setAmount(p); }} className="relative rounded-btn border border-border bg-surface-2 py-3.5 text-center transition hover:border-primary/50 active:scale-[.97]">
                <div className="num text-lg font-bold">{formatRub(p)}</div>
                {b > 0 && <div className="text-[11px] font-semibold text-success">+{formatRub(b)} бонус</div>}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <Input inputMode="numeric" maxLength={7} value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} placeholder="Другая сумма, ₽" />
          <Button variant="secondary" icon={<PlusCircle className="h-4 w-4" />} disabled={!custom} onClick={() => setAmount(Number(custom) * 100)}>Далее</Button>
        </div>
        {t && t.bonuses.length > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Бонус к пополнению: {t.bonuses.map((b) => `от ${formatRub(b.from)} — +${b.percent}%`).join(' · ')}</p>
        )}
      </Card>

      {canAuto && (
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"><RefreshCcw className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Автопродление</div>
            <div className="text-sm text-muted">За 3 дня до конца продлим тариф с баланса — вы не потеряете доступ.</div>
          </div>
          <Switch checked={Boolean(s?.autoRenew)} onChange={toggleAuto} />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">История операций</h2>
        {tx.isLoading ? <Skeleton className="h-24 w-full" /> : !tx.data?.length ? (
          <EmptyState title="Операций пока нет" text="Здесь появятся пополнения, покупки и бонусы." />
        ) : (
          <ul className="divide-y divide-border">
            {tx.data.slice(0, 20).map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', x.amount >= 0 ? 'bg-success/15 text-success' : 'bg-surface-2 text-muted')}>
                  {x.amount >= 0 ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{x.note || TYPE[x.type] || x.type}</div>
                  <div className="text-xs text-muted">{new Date(x.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className={cn('num text-sm font-semibold', x.amount >= 0 && 'text-success')}>{x.amount >= 0 ? '+' : '−'}{formatRub(Math.abs(x.amount))}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TopupSheet amount={amount} onClose={() => setAmount(null)} bonus={amount ? bonusFor(amount) : 0} />
    </div>
  );
}

function TopupSheet({ amount, bonus, onClose }: { amount: number | null; bonus: number; onClose: () => void }) {
  const methods = useMethods();
  const cfg = useConfig();
  const nav = useNavigate();
  const toast = useToast();
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const list: PaymentMethodDTO[] = (methods.data ?? []).filter((m) => m.provider !== 'balance');
  const chosen = method || list[0]?.id || '';
  const t = cfg.data?.topup;
  const bad = amount !== null && (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_TOPUP_KOPECKS || (t ? amount < t.min || amount > t.max : false));
  const maxRub = Math.min(t?.max ?? MAX_TOPUP_KOPECKS, MAX_TOPUP_KOPECKS);

  async function pay() {
    if (!amount) return;
    setBusy(true);
    try {
      const r = await post<{ id: string; payUrl: string | null }>('/payments', { topupAmount: amount, method: chosen });
      onClose();
      nav(`/payment/${r.id}`);
      if (r.payUrl) openExternal(r.payUrl);
    } catch (e) {
      haptic('error');
      toast(e instanceof ApiError ? e.message : 'Не удалось создать платёж', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={amount !== null} onClose={onClose} title="Пополнение баланса">
      {amount !== null && (
        <div className="space-y-5">
          <div className="rounded-btn bg-surface-2 p-4">
            <div className="text-sm text-muted">К оплате</div>
            <div className="num text-3xl font-bold">{formatRub(amount)}</div>
            {bonus > 0 && <div className="mt-1 text-sm font-medium text-success">+ {formatRub(bonus)} бонусом — на баланс придёт {formatRub(amount + bonus)}</div>}
            {bad && <div className="mt-2 text-sm text-danger">Сумма пополнения — от {formatRub(t?.min ?? 100)} до {formatRub(maxRub)}</div>}
          </div>
          <div className="space-y-2">
            {methods.isLoading ? (
              <Skeleton className="h-14 w-full" />
            ) : methods.isError ? (
              <div className="rounded-btn border border-danger/40 bg-danger/10 p-4 text-sm">
                Не удалось загрузить способы оплаты. Проверьте интернет и попробуйте ещё раз.
                <Button className="mt-3" size="sm" variant="secondary" loading={methods.isFetching} onClick={() => void methods.refetch()}>Повторить</Button>
              </div>
            ) : list.length === 0 ? (
              <div className="rounded-btn border border-warning/40 bg-warning/10 p-4 text-sm">Оплата пока недоступна: администратор не подключил способы оплаты.</div>
            ) : null}
            {list.map((m) => (
              <button key={m.id} onClick={() => setMethod(m.id)} className={cn('flex w-full items-center gap-3 rounded-btn border p-3.5 text-left transition', chosen === m.id ? 'border-primary bg-primary/8' : 'border-border hover:border-primary/40')}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-primary"><CreditCard className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><div className="font-medium">{m.title}</div>{m.hint && <div className="text-xs text-muted">{m.hint}</div>}</div>
                {chosen === m.id && <Badge tone="primary">Выбрано</Badge>}
              </button>
            ))}
          </div>
          <Field>
            <Button full size="lg" loading={busy} disabled={!chosen || bad} onClick={pay}>Пополнить на {formatRub(amount)}</Button>
          </Field>
        </div>
      )}
    </Sheet>
  );
}

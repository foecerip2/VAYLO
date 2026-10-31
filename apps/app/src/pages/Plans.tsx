import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '@vpn/ui';
import { PromoBanner } from '../components/PromoBanner';
import { useCampaigns, usePlans } from '../lib/queries';
import { durationLabel, formatRub, type PlanDTO, type ActiveCampaignDTO } from '@vpn/shared';
import { ArrowRight, Check, Gift, Infinity as InfinityIcon, Smartphone } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useMotionVisibility } from '../lib/useMotionVisibility';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { PurchaseSheet } from '../components/Purchase';
import { errorText } from '../lib/api';
import { haptic } from '../lib/tg';

export function perMonth(p: PlanDTO): string {
  const months = p.durationDays / 30;
  return months > 1 ? `${formatRub(Math.round(p.price / months / 100) * 100)} в месяц` : '';
}
function offer(p: PlanDTO, campaigns: ActiveCampaignDTO[]) {
  const campaign = campaigns.filter(c => c.kind === 'plan_discount' && (!c.planIds?.length || c.planIds.includes(p.id))).sort((a, b) => b.value - a.value)[0];
  return { campaign, price: campaign ? Math.max(0, p.price - Math.floor(p.price * campaign.value / 100)) : p.price };
}

export default function Plans() {
  const motion = useMotionVisibility<HTMLDivElement>();
  const plans = usePlans(); const camps = useCampaigns();
  const [choice, setChoice] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<PlanDTO | null>(null);
  const list = plans.data ?? [];
  const selected = list.find(p => p.id === choice) ?? list.find(p => p.badge && /лучш|выгод/i.test(p.badge)) ?? list[0];
  const selectedOffer = selected ? offer(selected, camps.data ?? []) : null;
  return <div {...motion} className="orbit-plans signature-plans animate-fade-up">
    <PageHeader title="Тарифы" subtitle="Выберите свой ритм свободы" right={<Link to="/addons" className="signature-addons-link">Докупки <ArrowRight className="h-4 w-4" /></Link>} />
    <PromoBanner kind="plan_discount" className="mb-4" />
    {plans.isLoading ? <div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 !rounded-card" />)}</div> : plans.isError ? <ErrorState message={errorText(plans.error)} onRetry={() => plans.refetch()} /> : !list.length ? <Card><EmptyState title="Тарифы пока не настроены" /></Card> : <div className="signature-plan-layout">
      <fieldset className="signature-plan-list" aria-label="Срок подписки"><legend className="sr-only">Выберите тариф</legend>{list.map((p, index) => {
        const { campaign, price } = offer(p, camps.data ?? []); const active = selected?.id === p.id;
        return <label key={p.id} className={cn('orbit-plan signature-plan', active && 'is-selected', campaign && 'orbit-plan-discounted')} style={{ '--plan-delay': `${Math.min(index, 5) * 70}ms` } as CSSProperties}>
          <input className="signature-plan-control" type="radio" name="subscription-plan" value={p.id} checked={active} onChange={() => { haptic('light'); setChoice(p.id); }} />
          <span className="signature-plan-radio" aria-hidden="true">{active && <span />}</span>
          <span className="signature-plan-copy"><span className="signature-plan-title">{p.name}</span><span className="signature-plan-description">{perMonth({ ...p, price }) || (p.name === durationLabel(p.durationDays) ? p.description || 'Базовый доступ' : durationLabel(p.durationDays))}</span>{p.badge && <Badge tone="primary">{p.badge}</Badge>}</span>
          <span className="signature-plan-price"><b>{formatRub(price)}</b>{campaign ? <><span className="line-through text-muted">{formatRub(p.price)}</span><span className="signature-discount">−{campaign.value}%</span></> : p.oldPrice ? <span className="line-through text-muted">{formatRub(p.oldPrice)}</span> : null}</span>
          <span className="orbit-plan-shine" aria-hidden="true" />
        </label>;
      })}</fieldset>
      {selected && selectedOffer && <div className="signature-plan-summary" aria-live="polite">
        <details className="signature-included"><summary>Что входит в подписку <span>+</span></summary><div><InfinityIcon /><span>{selected.trafficLimitGb ? `${selected.trafficLimitGb} ГБ трафика` : 'Безлимитный VPN-трафик'}</span></div><div><Smartphone /><span>{selected.deviceLimit ? `До ${selected.deviceLimit} устройств` : 'Без ограничений по устройствам'}</span></div><div><Check /><span>Все основные локации</span></div></details>
        <div className="signature-plan-note"><Gift className="h-5 w-5 shrink-0" /><p>{selectedOffer.campaign ? <>Ваша экономия — <b>{formatRub(selected.price - selectedOffer.price)}</b></> : <>Одна подписка для всех ваших устройств</>}<span>Дополнительный трафик LTE — в разделе докупок</span></p></div>
        <Button full size="lg" className="signature-purchase" onClick={() => setCheckout(selected)}>Продолжить <ArrowRight className="h-5 w-5" /></Button>
        <p className="mt-3 text-center text-xs leading-relaxed text-muted">Способ оплаты и итоговая стоимость — на следующем шаге</p>
      </div>}
    </div>}
    <PurchaseSheet item={checkout ? { kind: 'plan', plan: checkout } : null} onClose={() => setCheckout(null)} />
  </div>;
}

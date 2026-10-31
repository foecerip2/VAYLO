import { LteTraffic } from '../components/LteTraffic';
import { OrbitArtwork } from '../components/OrbitArtwork';
import { Badge, Card, ErrorState, Skeleton, useToast } from '@vpn/ui';
import { bytesToHuman, formatRub, pluralDays } from '@vpn/shared';
import { ArrowUpRight, CalendarDays, ChevronRight, Gift, Globe2, Infinity as InfinityIcon, Loader2, Plus, ShoppingBag, Smartphone, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { errorText } from '../lib/api';
import { useConfig, useMe, useNodes, useStartTrial, useSubscription } from '../lib/queries';
import { useMiniAppDesign } from '../lib/design';
import { haptic } from '../lib/tg';
import { PromoBanner } from '../components/PromoBanner';
import { ClosureBanner, useClosure } from '../components/Closure';
import { ServerStatusChip } from '../components/ServerStatusChip';
import { flag } from './Locations';

export default function Home() {
  const me = useMe(); const sub = useSubscription(); const cfg = useConfig(); const nodes = useNodes();
  const trial = useStartTrial(); const nav = useNavigate(); const toast = useToast();
  const design = useMiniAppDesign();
  const closing = !!useClosure().info;
  const s = sub.data ?? me.data?.subscription;
  const usable = !!s && !['none', 'expired'].includes(s.state);
  const canTrial = !closing && !!me.data?.trialAvailable && !!cfg.data?.trial.enabled && s?.state === 'none';
  const state = s?.state === 'trial' ? 'Пробный доступ' : usable ? 'Подписка активна' : s?.state === 'expired' ? 'Доступ закончился' : 'Добро пожаловать';
  async function connect() {
    haptic('light');
    if (canTrial) {
      try { await trial.mutateAsync(); haptic('success'); nav('/connect'); } catch (e) { toast(errorText(e), 'error'); }
    } else nav(usable ? '/connect' : '/plans');
  }
  if (me.isError) return <ErrorState message={errorText(me.error)} onRetry={() => void me.refetch()} />;
  return <div className="signature-home space-y-5">
    <div className="orbit-top"><div><div className="orbit-wordmark">{cfg.data?.brandName ?? 'VAYLO'}</div></div><Link to="/profile" aria-label="Открыть профиль" className="orbit-avatar">{me.data?.avatarUrl ? <img src={me.data.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : (me.data?.firstName ?? 'V')[0]}</Link></div>
    {cfg.data?.maintenance && <Card className="border-warning/40 bg-warning/10 p-4 text-sm">{cfg.data.maintenanceText || 'Технические работы. Возможны перебои.'}</Card>}
    <ClosureBanner full />
    {!closing && <PromoBanner />}
    <ServerStatusChip />
    <div className="orbit-home-grid space-y-5 md:space-y-0">
      <section className="signature-hero" aria-label="Ваша подписка">
        <OrbitArtwork design={design.id} />
        <div className="signature-hero-copy">
          <h1>Привет, <span>{me.data?.firstName ?? 'друг'}</span></h1>
          <Badge tone={usable ? 'success' : s?.state === 'expired' ? 'warning' : 'neutral'}>{state}</Badge>
          {!usable && <p className="hero-description">{canTrial ? `${cfg.data?.trial.days} ${pluralDays(cfg.data?.trial.days ?? 0)} бесплатно. Без привязки карты.` : 'Ваши сервисы. Ваш ритм. Одна подписка.'}</p>}
        </div>
        {usable && s && <Link to="/plans" className="signature-membership"><span className="signature-icon"><CalendarDays /></span><div><b>{s.daysLeft} {pluralDays(s.daysLeft)} доступа</b>{s.expiresAt && <span>до {new Date(s.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>}</div><ChevronRight className="ml-auto h-4 w-4 text-muted" /></Link>}
        {!s ? <Skeleton className="h-14 w-full" /> : <button className="orbit-cta" disabled={trial.isPending} onClick={() => void connect()}>{trial.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="signature-cta-icon" />}{canTrial ? 'Попробовать бесплатно' : usable ? 'Подключить устройство' : s.state === 'expired' ? 'Продлить подписку' : 'Выбрать тариф'}<ArrowUpRight className="h-5 w-5 shrink-0" /></button>}
        <div className="orbit-caption">Включите VPN в Happ, Incy или другом клиенте</div>
      </section>
      <div className="signature-dashboard space-y-3 vg-stagger">
        {usable && s && <div className="orbit-row signature-traffic"><span className="signature-icon"><InfinityIcon /></span><div><b>{s.trafficLimitBytes ? `${bytesToHuman(s.trafficUsedBytes)} из ${bytesToHuman(s.trafficLimitBytes)}` : 'VPN — безлимит'}</b><p className="mt-1 text-xs text-muted">{s.trafficLimitBytes ? s.planName ?? 'Ваша подписка' : 'Обычные локации без ограничений трафика'}</p></div></div>}
        <LteTraffic subscription={s ?? undefined} />
        <div className="orbit-grid"><Link to="/devices" className="orbit-stat"><Smartphone /><div><b>{usable && s ? s.deviceLimit ? `До ${s.deviceLimit} устр.` : 'Без лимита' : 'Устройства'}</b><span>В вашей подписке</span></div></Link><Link to="/wallet" className="orbit-stat"><Wallet /><div><b>{me.data ? formatRub(me.data.balance) : '—'}</b><span>На балансе</span></div></Link></div>
        {cfg.data?.addonsEnabled !== false && <Link to="/addons" className="orbit-row"><span className="signature-icon"><ShoppingBag /></span><div><b>Докупки LTE</b><p className="mt-1 text-xs text-muted">Пакеты трафика и дополнительные устройства</p></div><ChevronRight className="arrow" /></Link>}
        <section className="signature-locations"><div className="orbit-section-title">Ваши локации <Link to="/locations">Все →</Link></div><p className="mb-3 text-xs text-muted">Выберите сервер в VPN-клиенте</p>{nodes.isError ? <Link to="/locations" className="orbit-row"><Globe2 /><span className="text-sm">Посмотреть список локаций</span><ChevronRight className="arrow" /></Link> : nodes.isLoading ? <Skeleton className="h-32 w-full" /> : !nodes.data?.length ? <Link to="/locations" className="orbit-row"><Globe2 /><span className="text-sm">Открыть каталог локаций</span><ChevronRight className="arrow" /></Link> : nodes.data.slice(0, 3).map(n => <Link to="/locations" key={n.id} className="orbit-row"><span className="text-2xl">{flag(n.countryCode)}</span><div className="min-w-0"><b className="block truncate text-sm">{n.name}</b><span className="text-xs text-muted">{n.stale ? 'Статус устарел' : n.kind === 'location' ? 'В каталоге' : n.online ? 'Сервер на связи' : 'Связь потеряна'}</span></div><ChevronRight className="arrow" /></Link>)}</section>
        <Link to="/gifts" className="orbit-gift flex items-center gap-4"><Gift className="h-8 w-8 shrink-0 text-primary" /><div><div className="font-bold">Свобода — лучший подарок</div><p className="mt-1 text-xs leading-relaxed text-muted">Подарите подписку близкому человеку</p></div><ChevronRight className="ml-auto h-5 w-5 shrink-0 text-primary" /></Link>
        <Link to="/help" className="flex min-h-11 items-center justify-between px-1 text-sm text-muted"><span>Помочь с подключением?</span><ChevronRight className="h-4 w-4" /></Link>
      </div>
    </div>
  </div>;
}

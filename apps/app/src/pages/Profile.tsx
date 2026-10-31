import { useMiniAppDesign } from '../lib/design';
import { AvatarEditor } from '../components/AvatarEditor';
import { LteTraffic } from '../components/LteTraffic';
import { Badge, Button, Card, EmptyState, Input, Skeleton, Tabs, cn, useToast } from '@vpn/ui';
import { PROMO_MAX_LENGTH, formatRub, pluralDays, type PaymentDTO } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ExternalLink, Gift, History, LifeBuoy, LogOut, Megaphone, PackagePlus, Plus, ShieldCheck, Palette, Ticket, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAdminAttention, useConfig, useMe, usePayments } from '../lib/queries';
import { haptic, isTelegram, openExternal } from '../lib/tg';

const STATUS: Record<PaymentDTO['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  succeeded: { label: 'Оплачен', tone: 'success' },
  pending: { label: 'Ожидает', tone: 'warning' },
  canceled: { label: 'Отменён', tone: 'danger' },
  expired: { label: 'Истёк', tone: 'neutral' },
  refunded: { label: 'Возврат', tone: 'neutral' },
};

export default function Profile() {
  const me = useMe();
  const attn = useAdminAttention();
  const cfg = useConfig();
  const { logout } = useAuth();
  const design = useMiniAppDesign();
  const [tab, setTab] = useState<'info' | 'history'>('info');
  const tg = isTelegram();

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Профиль" />
      <Card className="flex items-center gap-4 p-5">
        <AvatarEditor url={me.data?.avatarUrl} name={me.data?.firstName??"?"}/>
        <div className="min-w-0 flex-1">
          {me.data ? <><div className="truncate text-lg font-semibold">{me.data.firstName ?? 'Пользователь'}</div><div className="truncate text-sm text-muted">{me.data.username ? '@' + me.data.username : `ID ${me.data.tgId ?? '—'}`}</div></> : <Skeleton className="h-10 w-40" />}
        </div>
      </Card>

      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <div className="text-sm text-muted">Баланс</div>
          <div className="text-3xl font-bold">{me.data ? formatRub(me.data.balance) : '—'}</div>
        </div>
        <Link to="/wallet"><Button icon={<Plus className="h-4 w-4" />}>Пополнить</Button></Link>
      </Card>

      <LteTraffic subscription={me.data?.subscription}/>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'info', label: 'Настройки' }, { value: 'history', label: 'История платежей' }]} />

      {tab === 'history' ? <History_ /> : (
        <div className="space-y-4">
          <Promo />
          <Card className="divide-y divide-border">
            <NavRow to="/gifts" icon={<Gift className="h-5 w-5 text-primary" />} label="Подарки" hint="Подарить или активировать подписку" />
            {cfg.data?.questsEnabled !== false && <NavRow to="/quests" icon={<Gift className="h-5 w-5 text-primary" />} label="Бонусы и задания" hint="Ежедневные награды" />}
            {cfg.data?.wheelEnabled !== false && <NavRow to="/wheel" icon={<Gift className="h-5 w-5 text-primary" />} label="Колесо удачи" hint="Ваш ежедневный приз" />}
            <NavRow to="/devices" icon={<ShieldCheck className="h-5 w-5 text-primary" />} label="Устройства" hint="Управление подключениями" />
          </Card>
          <Card className="divide-y divide-border">
            <NavRow to="/referrals" icon={<Users className="h-5 w-5 text-success" />} label="Пригласить друзей" hint="Ссылка, ранги, партнёрские ссылки" />
            <NavRow to="/addons" icon={<PackagePlus className="h-5 w-5 text-primary" />} label="Докупки" hint="Устройства и трафик LTE" />
            {me.data?.adminRole && <NavRow to="/admin" icon={<ShieldCheck className="h-5 w-5 text-warning" />} label="Админ-панель" hint={attn.data?.items.length ? attn.data.items.map((i) => i.title).slice(0, 2).join(' · ') : `Роль: ${me.data.adminRole}`} alert={attn.data?.total} />}
          </Card>
          <Card className="divide-y divide-border">
            {cfg.data?.supportInApp ? <NavRow to="/support" icon={<LifeBuoy className="h-5 w-5 text-primary" />} label="Поддержка" hint="ИИ-помощник и обращения" /> : cfg.data?.supportUrl && <Row icon={<LifeBuoy className="h-5 w-5" />} label="Поддержка" onClick={() => openExternal(cfg.data!.supportUrl)} />}
            {cfg.data?.channelUrl && <Row icon={<Megaphone className="h-5 w-5" />} label="Наш канал" onClick={() => openExternal(cfg.data!.channelUrl)} />}
            {cfg.data?.termsUrl && <Row icon={<ExternalLink className="h-5 w-5" />} label="Условия использования" onClick={() => openExternal(cfg.data!.termsUrl)} />}
            <div className="flex items-center gap-3 p-4"><Palette className="h-5 w-5 shrink-0 text-primary" /><div><div className="font-medium">{design.name}</div><p className="mt-1 text-xs text-muted">Оформление VAYLO · {design.mode === 'light' ? 'светлая тема' : 'тёмная тема'}</p></div></div>
            {!tg && <Row icon={<LogOut className="h-5 w-5" />} label="Выйти" danger onClick={logout} />}
          </Card>
        </div>
      )}
    </div>
  );
}

function NavRow({ to, icon, label, hint, alert }: { to: string; icon: React.ReactNode; label: string; hint?: string; alert?: number }) {
  return (
    <Link to={to} className="flex items-center gap-3 p-4 transition hover:bg-surface-2">
      <span>{icon}</span>
      <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span>{hint && <span className="block truncate text-xs text-muted">{hint}</span>}</span>
      {alert ? <span className="alert-dot" aria-label={`Требует внимания: ${alert}`}>{alert > 99 ? '99+' : alert}</span> : null}
      <ChevronRight className="h-5 w-5 text-muted" />
    </Link>
  );
}

function Row({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-2', danger && 'text-danger')}>
      <span className={danger ? '' : 'text-muted'}>{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
    </button>
  );
}

function Promo() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  async function redeem() {
    setBusy(true);
    try {
      const r = await post<{ type: 'days' | 'balance'; value: number }>('/promo/redeem', { code: code.trim() });
      haptic('success');
      toast(r.type === 'days' ? `Промокод активирован: +${r.value} ${pluralDays(r.value)}` : `Промокод активирован: +${formatRub(r.value)} на баланс`, 'success');
      setCode('');
      void qc.invalidateQueries();
    } catch (e) {
      haptic('error');
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 font-semibold"><Ticket className="h-5 w-5 text-primary" /> Промокод</div>
      <div className="flex gap-2">
        <Input value={code} maxLength={PROMO_MAX_LENGTH} onChange={(e) => setCode(e.target.value.slice(0, PROMO_MAX_LENGTH))} placeholder="Введите код" autoCapitalize="characters" onKeyDown={(e) => e.key === 'Enter' && code.trim() && redeem()} />
        <Button loading={busy} disabled={!code.trim()} onClick={redeem}>Применить</Button>
      </div>
      <p className="mt-2 text-xs text-muted">Скидочные коды вводятся при оплате тарифа.</p>
    </Card>
  );
}

function History_() {
  const p = usePayments();
  if (p.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (!p.data?.length) return <Card><EmptyState icon={<History className="h-6 w-6" />} title="Платежей пока нет" text="Здесь будет история ваших оплат и пополнений." /></Card>;
  return (
    <Card className="divide-y divide-border">
      {p.data.map((x) => (
        <div key={x.id} className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-primary">{x.purpose === 'plan' ? <Gift className="h-5 w-5" /> : x.purpose === 'addon' ? <PackagePlus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{x.gift ? `Подарок · ${x.planName ?? 'Подписка'}` : x.purpose === 'plan' ? x.planName ?? 'Тариф' : x.purpose === 'addon' ? x.planName ?? 'Докупка' : 'Пополнение баланса'}</div>
            <div className="text-xs text-muted">{new Date(x.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div className="text-right"><div className="font-semibold">{formatRub(x.amount)}</div><Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge></div>
        </div>
      ))}
    </Card>
  );
}

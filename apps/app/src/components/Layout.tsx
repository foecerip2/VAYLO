import { ClosureBanner } from './Closure';
import { Announcement } from './Announcement';
import { ErrorBoundary, cn, OfflineBanner } from '@vpn/ui';
import { formatRub } from '@vpn/shared';
import { Home, Shield, LifeBuoy, User, Wallet, WalletCards } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAttention, useConfig, useMe } from '../lib/queries';
import { haptic, webApp } from '../lib/tg';

const tabs = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/plans', label: 'Тарифы', icon: WalletCards },
  { to: '/help', label: 'Помощь', icon: LifeBuoy },
  { to: '/profile', label: 'Профиль', icon: User },
];

/** Telegram BackButton для вложенных экранов */
function useTelegramBack() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const tg = webApp();
    if (!tg?.initData) return;
    const root = ['/', '/plans', '/help', '/profile'].includes(loc.pathname);
    const back = () => {
      if(loc.pathname==='/admin/support'&&new URLSearchParams(loc.search).has('ticket')){const p=new URLSearchParams(loc.search);p.delete('ticket');nav({pathname:loc.pathname,search:p.toString()},{replace:true});}
      else nav(-1);
    };
    if (root) tg.BackButton.hide();
    else {
      tg.BackButton.show();
      tg.BackButton.onClick(back);
    }
    return () => tg.BackButton.offClick(back);
  }, [loc.pathname, loc.search, nav]);
}

/** «Перетекающая» подсветка активного пункта: меряем активный элемент внутри контейнера */
function useIndicator(selector: string) {
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const [ind, setInd] = useState({ left: 0, width: 0, on: false });
  const measure = () => {
    const el = box.current?.querySelector<HTMLElement>(selector);
    if (!el || !el.offsetWidth) return setInd((s) => ({ ...s, on: false }));
    setInd({ left: el.offsetLeft, width: el.offsetWidth, on: true });
  };
  useLayoutEffect(() => { measure(); }, [pathname]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, []);
  return { box, style: { left: ind.left, width: ind.width, opacity: ind.on ? 1 : 0 } };
}

function Logo({ name }: { name: string }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5">
      <span className="vg-logo"><i><Shield className="h-[18px] w-[18px]" /></i></span>
      <b className="truncate text-[15px] tracking-[.16em]">{name.toUpperCase()}</b>
    </Link>
  );
}

function TopNav({ name }: { name: string }) {
  const { box, style } = useIndicator('.vg-pill.on');
  const me = useMe();
  const attn = (useAdminAttention().data?.items.length ?? 0) > 0;
  return (
    <header className="signature-topnav sticky top-0 z-40 hidden border-b border-border/60 bg-bg/85 backdrop-blur-xl md:block">
      <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between gap-4 px-6">
        <Logo name={name} />
        <div ref={box} className="vg-pills">
          <span className="vg-ind" style={{ ...style, top: 5, bottom: 5 }} />
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn('vg-pill', isActive && 'on')}>
              <span className="relative"><t.icon className="h-4 w-4" />{t.to === '/profile' && attn && <span className="alert-dot sm abs" aria-label="Требует внимания" />}</span><span className="hidden lg:inline">{t.label}</span>
            </NavLink>
          ))}
        </div>
        <Link to="/wallet" className="hidden items-center gap-2 rounded-full border border-border/70 bg-surface/70 px-4 py-2 text-sm font-bold transition hover:border-primary/40 lg:flex">
          <Wallet className="h-4 w-4 text-primary" />{me.data ? formatRub(me.data.balance) : '—'}
        </Link>
      </div>
    </header>
  );
}

function TabBar() {
  const { box, style } = useIndicator('a.on');
  const attn = (useAdminAttention().data?.items.length ?? 0) > 0;
  return (
    <nav ref={box} className="tabbar md:hidden" aria-label="Разделы">
      <span className="vg-ind" style={style} />
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} onClick={() => haptic('light')} className={({ isActive }) => cn(isActive && 'on')}>
          <span className="relative"><t.icon className="h-[21px] w-[21px]" strokeWidth={2.2} />{t.to === '/profile' && attn && <span className="alert-dot sm abs" aria-label="Требует внимания" />}</span>
          <span className="max-w-full truncate px-0.5">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Layout(): ReactNode {
  const cfg = useConfig();
  const loc = useLocation();
  useTelegramBack();
  // фигурные скобки обязательны: в новых Chrome scrollTo возвращает Promise, и React принял бы его за функцию очистки
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);
  const name = cfg.data?.brandName ?? 'VPN';
  const banner = cfg.data?.appearance.banner;
  const supportThread = /^\/support\/.+/.test(loc.pathname) || loc.pathname==='/admin/support'&&new URLSearchParams(loc.search).has('ticket');
  return (
    <div className="relative min-h-dvh">

      <TopNav name={name} />
      <main className={cn("relative z-10 mx-auto w-full min-w-0 max-w-[1180px] px-4 pt-[calc(1rem+var(--safe-top))] md:px-6 md:pt-8", supportThread ? "pb-[calc(16px+var(--safe-bottom))] md:pb-4" : "pb-[calc(96px+var(--safe-bottom))] md:pb-12")}>
        {banner && !supportThread && <Announcement text={banner} />}
        <OfflineBanner />{loc.pathname !== '/' && <div className="mb-4"><ClosureBanner /></div>}<ErrorBoundary inline resetKey={loc.pathname} report="/api/v1/client-error" app="miniapp"><div key={loc.pathname} className="vg-page"><Outlet /></div></ErrorBoundary>
      </main>
      {!supportThread && <TabBar />}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="page-title text-[26px] tracking-tight md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

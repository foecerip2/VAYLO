import { ErrorBoundary, cn } from '@vpn/ui';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Banknote, BarChart3, Bell, Bot, Box, ChevronDown, ChevronsLeft, ChevronsRight, CreditCard, Disc3, Eye, Gift, Globe2, Hourglass, LifeBuoy, LogOut, Megaphone, Menu, Moon, PackagePlus, Radar, Server, ScrollText, Settings, Sun, Tag, Target, Trophy, Users, WalletCards, Wifi, X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAdminTheme } from '../lib/theme';
import { useAttention } from '../lib/attention';
import type { AdminRole } from '@vpn/shared';

interface Item { to: string; label: string; icon: ComponentType<{ className?: string }>; min: AdminRole; end?: boolean; group: string }

/** Разделы бокового меню: «Главное», затем группы ниже */
const MAIN: Item[] = [
  { to: '/', label: 'Обзор', icon: BarChart3, end: true, min: 'analyst', group: 'Главное' },
  { to: '/users', label: 'Пользователи', icon: Users, min: 'analyst', group: 'Главное' },
  { to: '/payments', label: 'Платежи', icon: CreditCard, min: 'analyst', group: 'Главное' },
  { to: '/support', label: 'Поддержка', icon: LifeBuoy, min: 'support', group: 'Главное' },
  { to: '/nodes', label: 'Ноды', icon: Globe2, min: 'analyst', group: 'Главное' },
  { to: '/lte-activity', label: 'Активность LTE', icon: Wifi, min: 'analyst', group: 'Главное' },
  { to: '/referrals', label: 'Рефералы', icon: Gift, min: 'analyst', group: 'Главное' },
  { to: '/activity', label: 'Активность', icon: Eye, min: 'analyst', group: 'Главное' },
];
const GROUPS = ['Главное', 'Продажи', 'Вовлечение', 'Система'];
const MORE: Item[] = [
  { to: '/plans', label: 'Тарифы', icon: WalletCards, min: 'analyst', group: 'Продажи' },
  { to: '/gifts', label: 'Подарки', icon: Gift, min: 'analyst', group: 'Продажи' },
  { to: '/campaigns', label: 'Акции', icon: Gift, min: 'analyst', group: 'Продажи' },
  { to: '/promo', label: 'Промокоды', icon: Tag, min: 'analyst', group: 'Продажи' },
  { to: '/catalog', label: 'Докупки', icon: PackagePlus, min: 'analyst', group: 'Продажи' },
  { to: '/withdrawals', label: 'Выводы', icon: Banknote, min: 'analyst', group: 'Продажи' },
  { to: '/broadcasts', label: 'Рассылки', icon: Megaphone, min: 'analyst', group: 'Вовлечение' },
  { to: '/quests', label: 'Квесты', icon: Target, min: 'analyst', group: 'Вовлечение' },
  { to: '/wheel', label: 'Колесо', icon: Disc3, min: 'analyst', group: 'Вовлечение' },
  { to: '/contests', label: 'Конкурсы', icon: Trophy, min: 'analyst', group: 'Вовлечение' },
  { to: '/closure', label: 'Закрытие проекта', icon: Hourglass, min: 'admin', group: 'Система' },
  { to: '/ads', label: 'Реклама и посты', icon: Megaphone, min: 'analyst', group: 'Вовлечение' },
  { to: '/growth', label: 'Скидки и воронка', icon: Megaphone, min: 'analyst', group: 'Вовлечение' },
  { to: '/bot', label: 'Приветствие бота', icon: Bot, min: 'admin', group: 'Вовлечение' },
  { to: '/status-servers', label: 'Статус серверов', icon: Server, min: 'analyst', group: 'Система' },
  { to: '/network', label: 'Доступность', icon: Radar, min: 'analyst', group: 'Система' },
  { to: '/network-intelligence', label: 'Сеть: аналитика', icon: Radar, min: 'analyst', group: 'Система' },
  { to: '/node-recommendations', label: 'Подбор локации', icon: Globe2, min: 'analyst', group: 'Система' },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3, min: 'analyst', group: 'Продажи' },
  { to: '/monitoring', label: 'Мониторинг', icon: Activity, min: 'analyst', group: 'Система' },
  { to: '/audit', label: 'Аудит', icon: ScrollText, min: 'admin', group: 'Система' },
  { to: '/trial-cleanup', label: 'Очистка триалов', icon: Users, min: 'admin', group: 'Система' },
  { to: '/settings', label: 'Настройки', icon: Settings, min: 'admin', group: 'Система' },
];

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

function Logo() {
  return (
    <Link to="/" className="admin-logo flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="vg-logo"><i><Box className="h-4 w-4" /></i></span>
      <span className="leading-tight"><b className="block text-[15px] tracking-[.18em]">VAYLO</b><small className="text-[10px] tracking-[.18em] text-primary">ORBIT · ADMIN</small></span>
    </Link>
  );
}

/** Боковое меню: на ПК сворачивается в иконки (состояние запоминается), на телефоне заменено кнопкой-«бургером» */
function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { can } = useAuth();
  const items = [...MAIN, ...MORE].filter((n) => can(n.min));
  const attn = useAttention();
  return (
    <aside className={cn('vg-side', collapsed && 'collapsed')} aria-label="Разделы">
      <div className={cn('mb-2 flex h-[48px] items-center', collapsed ? 'justify-center' : 'justify-between px-1')}>
        {collapsed ? <Link to="/" aria-label="VAYLO"><span className="vg-logo"><i><Box className="h-4 w-4" /></i></span></Link> : <Logo />}
      </div>
      {GROUPS.map((g) => {
        const list = items.filter((n) => n.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className="flex flex-col gap-1">
            <div className="grp">{g}</div>
            {list.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined} aria-label={n.label} className={({ isActive: a }) => cn('vg-link', a && 'on')}>
                <n.icon className="h-[18px] w-[18px]" /><span className="t">{n.label}</span>
                {attn.byPath[n.to] && <span className="vg-alert" aria-label={`Требует внимания: ${attn.byPath[n.to]!.count}`}>{attn.byPath[n.to]!.count > 99 ? '99+' : attn.byPath[n.to]!.count}</span>}
              </NavLink>
            ))}
          </div>
        );
      })}
      <button type="button" onClick={onToggle} className={cn('vg-link mt-auto', collapsed && '!justify-center')} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : undefined}>
        {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}<span className="t">Свернуть меню</span>
      </button>
    </aside>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useAdminTheme();
  const light = theme === 'light';
  return (
    <button type="button" className="vg-round" aria-label={light ? 'Включить тёмную тему' : 'Включить светлую тему'} title={light ? 'Тёмная тема' : 'Светлая тема'} onClick={() => setTheme(light ? 'dark' : 'light')}>
      {light ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
    </button>
  );
}

function Alerts() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutside(open, close);
  const attn = useAttention();
  const has = attn.items.length > 0;
  const { pathname } = useLocation();
  useEffect(() => { close(); }, [pathname]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="vg-round" aria-label={has ? `Уведомления, требуют внимания: ${attn.total}` : 'Уведомления'} onClick={() => setOpen((v) => !v)}>
        <Bell className="h-[18px] w-[18px]" />{has && <span className="vg-alert">{attn.total > 99 ? '99+' : attn.total}</span>}
      </button>
      {open && (
        <div className="vg-menu w-80 max-w-[calc(100vw-32px)]">
          <div className="px-3 pb-2 pt-1 text-sm font-bold">Требует внимания</div>
          {!has && <p className="px-3 pb-3 text-sm text-muted">Всё спокойно — проблем и заявок нет.</p>}
          {attn.items.map((i) => (
            <Link key={i.key} to={i.web}>
              <span className={cn('ic', i.level === 'critical' && '!bg-danger/15 !text-danger')}>{i.key === 'withdrawals' ? <Banknote className="h-4 w-4" /> : i.key === 'support' ? <LifeBuoy className="h-4 w-4" /> : i.key === 'unfulfilled' ? <CreditCard className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span>
              <span className="min-w-0 flex-1">{i.title}</span>
              <span className="vg-alert">{i.count > 99 ? '99+' : i.count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Profile() {
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutside(open, close);
  const { pathname } = useLocation();
  useEffect(() => { close(); }, [pathname]);
  const name = me?.email.split('@')[0] ?? '';
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2.5 rounded-full border border-fg/10 bg-fg/[.04] py-1 pl-1 pr-3 transition hover:border-primary/40">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-primary-2 text-sm font-extrabold uppercase text-white shadow-[0_0_16px_rgba(217,70,239,.5)]">{name[0] ?? 'A'}</span>
        <span className="hidden text-left leading-tight sm:block"><b className="block max-w-[140px] truncate text-[13px]">{name}</b><small className="text-[11px] capitalize text-muted">{me?.role}</small></span>
        <ChevronDown className={cn('hidden h-4 w-4 text-muted transition sm:block', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="vg-menu w-72 max-w-[calc(100vw-32px)]">
          <div className="px-3 pb-3 pt-1"><div className="truncate text-sm font-bold">{me?.email}</div><div className="text-xs capitalize text-muted">роль: {me?.role}</div></div>

          {can('admin') && <Link to="/settings"><span className="ic"><Settings className="h-4 w-4" /></span>Настройки и безопасность</Link>}
          <button type="button" className="item hover:!text-danger" onClick={logout}><span className="ic !bg-danger/15 !text-danger"><LogOut className="h-4 w-4" /></span>Выйти</button>
        </div>
      )}
    </div>
  );
}

function MobileNav({ onClose }: { onClose: () => void }) {
  const { can, logout } = useAuth();
  const all = [...MAIN, ...MORE].filter((n) => can(n.min));
  const attn = useAttention();
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-80 max-w-[88vw] flex-col gap-4 overflow-y-auto border-l border-fg/10 bg-surface/95 p-5 backdrop-blur-xl" style={{ animation: 'vg-pop .3s cubic-bezier(.2,.9,.3,1.1) both', transformOrigin: 'right center' }}>
        <div className="flex items-center justify-between"><Logo /><button onClick={onClose} aria-label="Закрыть" className="vg-round !h-10 !w-10"><X className="h-5 w-5" /></button></div>
        <nav className="vg-menu !static !animate-none !border-0 !bg-transparent !p-0 !shadow-none">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted/70">{g}</div>
              {all.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose} className={({ isActive: a }) => cn(a && 'on')}><span className="ic"><n.icon className="h-4 w-4" /></span>{n.label}{attn.byPath[n.to] && <span className="vg-alert">{attn.byPath[n.to]!.count > 99 ? '99+' : attn.byPath[n.to]!.count}</span>}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button onClick={logout} className="mt-auto flex h-11 items-center justify-center gap-2 rounded-full border border-fg/10 text-sm text-muted hover:text-danger"><LogOut className="h-4 w-4" />Выйти</button>
      </div>
    </div>
  );
}

function MenuButton({ onClick }: { onClick: () => void }) {
  const { items } = useAttention();
  return <button onClick={onClick} aria-label="Меню" className="vg-round"><Menu className="h-5 w-5" />{items.length > 0 && <span className="vg-alert dot" />}</button>;
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('admin-sidebar') === '1'; } catch { return false; } });
  const loc = useLocation();
  const toggle = () => setCollapsed((v) => { try { localStorage.setItem('admin-sidebar', v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  // фигурные скобки обязательны: в новых Chrome scrollTo возвращает Promise, и React принял бы его за функцию очистки
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);
  return (
    <div className="relative min-h-dvh">

      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className={cn('vg-main relative z-10 min-w-0', collapsed && 'collapsed')}>
        <header className="sticky top-0 z-40 border-b border-fg/[.06] bg-bg/70 backdrop-blur-xl" style={{ paddingTop: 'var(--safe-top)' }}>
          <div className="mx-auto flex h-[64px] min-w-0 max-w-[1480px] items-center justify-between gap-2 px-3 sm:px-4 md:px-8">
            <div className="lg:hidden"><Logo /></div>
            <div className="hidden lg:block" />
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
              <ThemeToggle />
              <Alerts />
              <div className="hidden lg:block"><Profile /></div>
              <div className="lg:hidden"><MenuButton onClick={() => setOpen(true)} /></div>
            </div>
          </div>
        </header>
        {open && <MobileNav onClose={() => setOpen(false)} />}
        <main className="relative mx-auto w-full min-w-0 max-w-[1480px] px-3 py-4 sm:px-4 md:px-8 md:py-8">
          {loc.pathname === '/' && <section className="admin-orbit-banner"><div><span className="orbit-kicker">VAYLO / ORBIT</span><h1>Ваш сервис.<br />Всё под контролем.</h1><p>Подписки, пользователи и поддержка — в одном месте.</p></div><img src="/orbit-art.png" alt="" aria-hidden="true" /></section>}
          <ErrorBoundary inline resetKey={loc.pathname} report="/api/v1/client-error" app="admin"><div key={loc.pathname} className="vg-page min-w-0"><Outlet /></div></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

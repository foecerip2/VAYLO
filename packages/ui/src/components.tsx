import { clsx } from 'clsx';
import { AlertCircle, Check, Copy, Loader2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from './scroll-lock';
import { Component, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ErrorInfo, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const cn = clsx;

/* ---------------- Button ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
  icon?: ReactNode;
}
const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-br from-primary to-primary-2 text-primary-fg shadow-[0_6px_18px_-6px_rgb(var(--primary)/.6)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-fg hover:bg-border/60 active:bg-border',
  ghost: 'bg-transparent text-fg hover:bg-surface-2 active:bg-border/60',
  danger: 'bg-danger text-white hover:brightness-110 active:brightness-95',
};
const sizes: Record<Size, string> = { sm: 'h-9 px-3 text-sm gap-1.5', md: 'h-11 px-4 text-[15px] gap-2', lg: 'h-14 px-6 text-base gap-2.5' };
export function Button({ variant = 'primary', size = 'md', loading, full, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-btn font-medium transition duration-150 ease-soft active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        full && 'w-full',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ---------------- Surface ---------------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('card', className)}>
      {children}
    </div>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>}
      <div className="text-base font-semibold">{title}</div>
      {text && <div className="max-w-sm text-sm text-muted">{text}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState icon={<AlertCircle className="h-6 w-6 text-danger" />} title="Не удалось загрузить" text={message} action={onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Повторить</Button>} />
  );
}

/* ---------------- Form ---------------- */
export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
const inputBase = 'w-full min-w-0 rounded-input border border-border bg-surface-2 px-3.5 text-base sm:text-[15px] text-fg placeholder:text-muted/70 transition focus:border-primary focus:bg-surface disabled:opacity-60';
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(inputBase, 'h-11', className)} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(inputBase, 'min-h-24 py-3', className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(inputBase, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%238a92ab' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cn('relative h-7 w-12 shrink-0 rounded-full transition duration-200', checked ? 'bg-primary' : 'bg-border', disabled && 'opacity-50')}>
      <span className={cn('absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition duration-200 ease-soft', checked && 'translate-x-5')} />
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 rounded-btn bg-surface-2 p-1">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)} className={cn('h-9 whitespace-nowrap rounded-[9px] px-3.5 text-sm font-medium transition', value === i.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Overlays ---------------- */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const [viewport,setViewport]=useState<{height:number;top:number}|null>(null);
  useEffect(()=>{
    if(!open)return;
    const update=()=>setViewport({height:window.visualViewport?.height??window.innerHeight,top:window.visualViewport?.offsetTop??0});
    update();window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    return()=>{window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
  },[open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const unlock=lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open, onClose]);
  if (!open) return null;
  // Портал в body: предки с transform (анимации страниц) ломают position: fixed
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" style={viewport?{top:viewport.top,height:viewport.height,bottom:'auto'}:undefined} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined}>
      <div className="absolute inset-0 animate-fade-up bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative min-w-0 w-full animate-fade-up overflow-y-auto rounded-t-[24px] border border-border bg-surface p-5 shadow-2xl md:rounded-[24px]', wide ? 'md:max-w-2xl' : 'md:max-w-md')} style={{ maxHeight:viewport?Math.max(0,viewport.height-16):'92dvh',paddingBottom: 'calc(1.25rem + var(--safe-bottom))' }}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 id={id} className="min-w-0 flex-1 break-words text-lg font-semibold">{title}</h2>}
          <button type="button" onClick={onClose} aria-label="Закрыть" className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Toast ---------------- */
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((x) => [...x.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4" style={{ paddingTop: 'calc(1rem + var(--safe-top))' }} aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="glass pointer-events-auto flex max-w-sm animate-fade-up items-center gap-2.5 rounded-btn border border-border px-4 py-3 text-sm shadow-card">
            {t.kind === 'success' ? <Check className="h-4 w-4 shrink-0 text-success" /> : t.kind === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-danger" /> : null}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Data display ---------------- */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    toast('Скопировано', 'success');
    setTimeout(() => setDone(false), 1800);
  }
  return (
    <div>
      {label && <div className="mb-1.5 text-sm font-medium">{label}</div>}
      <div className="flex items-center gap-2 rounded-btn border border-border bg-surface-2 p-1.5 pl-3.5">
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={value}>{value}</div>
        <Button size="sm" variant="secondary" onClick={copy} icon={done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}>
          {done ? 'Готово' : 'Копировать'}
        </Button>
      </div>
    </div>
  );
}

/** Кольцевой прогресс (дни/трафик). value 0..1 */
export function ProgressRing({ value, size = 96, stroke = 8, children, color = 'currentColor', track = 'rgba(255,255,255,.25)' }: { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string; track?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'warning' | 'danger' | 'light' }) {
  const bg = { primary: 'bg-primary', warning: 'bg-warning', danger: 'bg-danger', light: 'bg-white' }[tone];
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full', tone === 'light' ? 'bg-white/25' : 'bg-surface-2')} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-soft', bg)} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function KpiTile({ label, value, sub, icon, tone = 'primary' }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-muted">{label}</div>
        {icon && <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tones[tone])}>{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight md:text-[28px]">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} aria-label="Загрузка" />;
}

export function Logo({ name = 'VPN', className }: { name?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="hero-bg flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-glow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6l-8-3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>
      </div>
      <span className="text-lg font-bold tracking-tight">{name}</span>
    </div>
  );
}

/* ---------------- Error boundary ---------------- */
/** Верхнеуровневый перехват ошибок рендера: вместо белого экрана — понятное сообщение и перезагрузка */
const CHUNK_ERR = /Loading chunk|dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|ChunkLoadError|Unable to preload CSS/i;

/** Отправка ошибки интерфейса на сервер (видна в логах API: docker logs vpn-api | grep client-error) */
export function reportClientError(url: string | undefined, app: string, error: unknown, extra?: string) {
  if (!url) return;
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({ app, message: e.message.slice(0, 500), stack: (e.stack ?? '').slice(0, 3000), component: (extra ?? '').slice(0, 2000), where: location.pathname.slice(0, 300), ua: navigator.userAgent.slice(0, 300) });
    void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Перехват ошибок отрисовки. resetKey — при его смене (переход на другую страницу) ошибка сбрасывается сама.
 * inline — показывать карточку внутри страницы, не на весь экран. Ошибки устаревших файлов после обновления
 * (браузер держит старую версию) лечатся одной автоматической перезагрузкой.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; inline?: boolean; report?: string; app?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] ошибка отрисовки', error, info.componentStack);
    if (CHUNK_ERR.test(error?.message ?? '')) {
      try {
        const last = Number(sessionStorage.getItem('chunk_reload_at') ?? 0);
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem('chunk_reload_at', String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        /* ignore */
      }
    }
    reportClientError(this.props.report, this.props.app ?? 'web', error, info.componentStack ?? '');
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={cn('flex items-center justify-center', this.props.inline ? 'py-10' : 'min-h-dvh p-6')}>
        <Card className="w-full max-w-sm p-6 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-danger" />
          <h1 className="mt-3 text-lg font-bold">Что-то пошло не так</h1>
          <p className="mt-2 text-sm text-muted">{this.props.inline ? 'Этот раздел не открылся. Остальное приложение работает — можно вернуться назад.' : 'Страница не смогла загрузиться. Попробуйте обновить её.'} Ошибка уже отправлена разработчику.</p>
          <p className="mt-3 break-words rounded-xl bg-danger/10 px-3 py-2 text-left font-mono text-[11px] leading-snug text-danger">{String(error.message || error).slice(0, 240)}</p>
          <div className="mt-5 grid gap-2">
            {this.props.inline && <Button full onClick={() => window.history.back()}>Назад</Button>}
            <Button full variant={this.props.inline ? 'secondary' : 'primary'} onClick={() => this.setState({ error: null })}>Повторить</Button>
            <Button full variant="ghost" onClick={() => window.location.reload()}>Перезагрузить</Button>
          </div>
        </Card>
      </div>
    );
  }
}

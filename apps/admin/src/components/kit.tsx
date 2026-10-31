import { Button, Card, EmptyState, Skeleton, cn } from '@vpn/ui';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** показывать как заголовок карточки на мобильных */
  primary?: boolean;
  align?: 'right';
}

/** Таблица на десктопе → список карточек на телефоне */
export function DataTable<T extends { id?: string | number }>({ columns, rows, loading, empty, onRowClick, rowKey }: { columns: Column<T>[]; rows?: T[]; loading?: boolean; empty?: string; onRowClick?: (r: T) => void; rowKey?: (r: T, i: number) => string | number }) {
  const key = (r: T, i: number) => rowKey?.(r, i) ?? r.id ?? i;
  if (loading) return <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  if (!rows?.length) return <Card><EmptyState icon={<Inbox className="h-6 w-6" />} title={empty ?? 'Ничего не найдено'} /></Card>;
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  return (
    <>
      <Card className="hidden min-w-0 max-w-full overflow-hidden !p-0 md:block">
        <div className="overflow-x-auto">
          <table className="vg w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                {columns.map((c) => <th key={c.key} className={cn('px-4 py-3 font-medium', c.align === 'right' && 'text-right', c.className)}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={key(r, i)} onClick={() => onRowClick?.(r)} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} className={cn('transition', onRowClick && 'cursor-pointer')}>
                  {columns.map((c) => <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right', c.className)}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="vg-stagger space-y-2.5 md:hidden">
        {rows.map((r, i) => (
          <Card key={key(r, i)} className={cn('admin-data-card min-w-0 break-words p-4', onRowClick && 'active:scale-[.99] transition')} onClick={() => onRowClick?.(r)}>
            <div className="mb-2 min-w-0 font-semibold">{primary.render(r)}</div>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-3 min-[400px]:grid-cols-2 text-sm">
              {columns.filter((c) => c !== primary).map((c) => (
                <div key={c.key} className="min-w-0"><dt className="text-xs text-muted">{c.header}</dt><dd className="min-w-0 break-words">{c.render(r)}</dd></div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}

export function Pagination({ page, limit, total, onChange }: { page: number; limit: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>{(page - 1) * limit + 1}–{Math.min(page * limit, total)} из {total}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Назад"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="tabular px-1">{page} / {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Вперёд"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="bg-gradient-to-r from-fg via-fg to-primary-2 bg-clip-text text-2xl tracking-tight text-transparent md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, description, children, right }: { title: string; description?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="font-semibold">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}</div>
        {right}
      </div>
      {children}
    </Card>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

/** Серые заготовки блоков (скелетоны) — повторяют форму будущего контента, пока грузятся данные */
export function Sk({ className }: { className?: string }) {
  return <div className={cn('vg-sk', className)} aria-hidden />;
}
export const SkRows = ({ n = 3 }: { n?: number }) => (
  <div className="space-y-3.5" aria-busy="true" aria-label="Загрузка">
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex items-center gap-3"><Sk className="h-8 w-8 !rounded-xl" /><Sk className="h-3.5 flex-1" /><Sk className="h-3.5 w-16" /></div>
    ))}
  </div>
);
const BAR_H = [45, 70, 55, 90, 62, 80, 50];
export const SkBars = ({ n = 7 }: { n?: number }) => (
  <div className="flex h-full items-end gap-3" aria-busy="true" aria-label="Загрузка">
    {Array.from({ length: n }, (_, i) => <div key={i} className="vg-sk flex-1 !rounded-xl" style={{ height: `${BAR_H[i % BAR_H.length]}%` }} />)}
  </div>
);
export const SkDonut = () => (
  <div className="flex flex-wrap items-center gap-5" aria-busy="true" aria-label="Загрузка">
    <Sk className="h-[170px] w-[170px] !rounded-full" />
    <div className="min-w-[150px] flex-1 space-y-3">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-4 w-full" />)}</div>
  </div>
);

/** Пустой блок: понятное сообщение и кнопка «что сделать дальше» */
export function Empty({ icon, title, text, to, action }: { icon?: ReactNode; title: string; text?: string; to?: string; action?: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-2 py-6 text-center">
      {icon && <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</div>}
      <div className="text-[15px] font-bold">{title}</div>
      {text && <div className="max-w-xs text-[13px] text-muted">{text}</div>}
      {to && action && <Link to={to} className="mt-1 inline-flex h-9 items-center rounded-full bg-primary/15 px-4 text-[13px] font-bold text-primary transition hover:bg-primary/25">{action}</Link>}
    </div>
  );
}

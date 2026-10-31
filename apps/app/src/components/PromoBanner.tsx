import { useMotionVisibility } from '../lib/useMotionVisibility';
import { ChevronDown, Flame } from 'lucide-react';
import { useState } from 'react';
import { useCampaigns } from '../lib/queries';

const until = (iso: string | null) => (iso ? ` · до ${new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : '');

/** Баннер действующих акций (скидка на тарифы / бонус к пополнению), если они есть для пользователя */
export function PromoBanner({ kind, className = '' }: { kind?: 'plan_discount' | 'topup_bonus'; className?: string }) {
  const motion = useMotionVisibility<HTMLDivElement>();
  const q = useCampaigns();
  const all = (q.data ?? []).filter((c) => !kind || c.kind === kind);
  const [open, setOpen] = useState(false);
  if (!all.length) return null;
  // главный экран: одна акция, остальные под кнопкой «ещё N» — герой и кнопка подключения не уезжают вниз
  const list = open || all.length < 2 ? all : all.slice(0, 1);
  return (
    <div {...motion} className={`orbit-promotions space-y-2 ${className}`}>
      {list.map((c) => (
        <div key={c.id} className="orbit-promo relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/25 via-primary-2/15 to-transparent p-3.5">
          <span className="orbit-promo-sheen" aria-hidden="true" /><div className="relative flex items-center gap-3">
            <span className="orbit-promo-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/25 text-primary"><Flame className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-bold leading-tight">{c.title}</div>
              <div className="text-xs text-muted">{c.kind === 'plan_discount' ? `Скидка ${c.value}% на ${c.planIds?.length ? 'выбранные тарифы' : 'все тарифы'}` : `+${c.value}% к каждому пополнению`}{until(c.endsAt)}</div>
            </div>
            <div className="orbit-promo-value num shrink-0 text-xl font-extrabold text-primary">{c.kind === 'plan_discount' ? `−${c.value}%` : `+${c.value}%`}</div>
          </div>
        </div>
      ))}
      {all.length > 1 && <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-center gap-1 text-xs text-muted">{open ? 'Свернуть' : `Ещё акций: ${all.length - 1}`}<ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /></button>}
    </div>
  );
}

import { MINIAPP_DESIGNS, type MiniAppDesignId } from '@vpn/shared';
import { Badge, Button, Sheet, cn } from '@vpn/ui';
import { Check, Expand, Palette } from 'lucide-react';
import { useState } from 'react';

/** Published design is global. Changing a radio is a draft until GroupForm saves it. */
export function DesignPicker({ value, onChange }: { value: MiniAppDesignId; onChange: (value: MiniAppDesignId) => void }) {
  const [preview, setPreview] = useState<MiniAppDesignId | null>(null);
  const selected = MINIAPP_DESIGNS.find(d => d.id === preview);
  return <section aria-label="Дизайн Mini App" className="space-y-4">
    <div className="rounded-2xl border border-primary/20 bg-primary/[.04] p-4"><div className="flex items-center gap-2 font-semibold"><Palette className="h-4 w-4 text-primary" />Два оформления VAYLO</div><p className="mt-2 text-sm leading-relaxed text-muted">Выберите общую тему для пользователей. Нажмите «Сохранить» внизу, чтобы применить её к Mini App. Открытое приложение получит оформление в течение минуты или при возвращении в него.</p></div>
    <fieldset className="grid gap-4 lg:grid-cols-2"><legend className="sr-only">Оформление Mini App</legend>{MINIAPP_DESIGNS.map(d => {
      const active = value === d.id;
      return <article key={d.id} className={cn('min-w-0 overflow-hidden rounded-2xl border bg-surface transition', active ? 'border-primary ring-1 ring-primary/30' : 'border-border')}>
        <label className="block cursor-pointer focus-within:ring-2 focus-within:ring-primary">
          <img className="aspect-[3/2] w-full object-contain bg-[#ecf1f8]" src={`/design-themes/${d.id}.png`} alt={`${d.name}: главная и тарифы`} loading="lazy" />
          <div className="space-y-3 p-4"><div className="flex items-center gap-3"><input type="radio" name="miniapp-design" value={d.id} checked={active} onChange={() => onChange(d.id)} className="h-5 w-5 shrink-0 accent-primary" /><h3 className="min-w-0 flex-1 font-semibold">{d.code} · {d.name}</h3>{active && <Check className="h-5 w-5 shrink-0 text-primary" />}</div><p className="text-sm leading-relaxed text-muted">{d.description}</p><div className="flex flex-wrap gap-2"><Badge tone={active ? 'primary' : 'neutral'}>{active ? 'Выбрано в форме' : 'Выбрать'}</Badge><Badge>{d.mode === 'light' ? 'Светлая' : 'Тёмная'}</Badge></div></div>
        </label>
        <div className="px-4 pb-4"><Button type="button" size="sm" variant="ghost" onClick={() => setPreview(d.id)} icon={<Expand className="h-4 w-4" />}>Посмотреть крупнее</Button></div>
      </article>;
    })}</fieldset>
    <p className="text-xs leading-relaxed text-muted">Цвета, навигация, карточки, оплата и анимации меняются вместе. Изображения показывают реальные экраны на демонстрационных данных. Карточки подарков сохраняют выбранный отправителем стиль.</p>
    <Sheet open={!!selected} onClose={() => setPreview(null)} title={selected?.name ?? ''} wide>{selected && <div className="space-y-4"><a href={`/design-themes/${selected.id}.png`} target="_blank" rel="noreferrer"><img src={`/design-themes/${selected.id}.png`} alt={`Экраны ${selected.name}`} className="w-full rounded-xl" /></a><p className="text-sm text-muted">{selected.description} Цены, имя и трафик на изображении приведены для демонстрации.</p><Button type="button" onClick={() => { onChange(selected.id); setPreview(null); }}>Выбрать {selected.name}</Button></div>}</Sheet>
  </section>;
}

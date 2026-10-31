import { Notifications } from './Notifications';
import { Badge, Button, Card, Field, Input } from '@vpn/ui';
import { Plus, Trash2 } from 'lucide-react';
import { isValidChannelUrl, normalizeChannelUrl, resolveMiniAppDesign } from '@vpn/shared';
import { GroupForm, Toggle } from '../components/GroupForm';
import { DesignPicker } from '../components/DesignPicker';

export type MoreTab = 'gate' | 'topup' | 'features' | 'notifications' | 'monitoring' | 'appearance';

const num = (set: (k: string, v: unknown) => void, k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === '' ? 0 : Number(e.target.value));
const toKop = (v: string) => Math.round(Number(v.replace(',', '.') || 0) * 100);

export function MoreTabs({ tab, s, botUsername, locked }: { tab: MoreTab; s: Record<string, any>; botUsername: string; locked: boolean }) {
  if (tab === 'gate') return <Gate s={s} botUsername={botUsername} locked={locked} />;
  if (tab === 'topup') return <Topup s={s} locked={locked} />;
  if (tab === 'features') return <Features s={s} locked={locked} />;
  if (tab === 'notifications') return <Notifications data={s.admin_notifications} locked={locked} />;
  if (tab === 'monitoring') return <Monitoring s={s} locked={locked} />;
  return <Appearance s={s} locked={locked} />;
}

function Gate({ s, botUsername, locked }: { s: Record<string, any>; botUsername: string; locked: boolean }) {
  return (
    <GroupForm group="gate" data={s.gate} locked={locked} invalid={(v) => (v.chats as { url: string }[]).some((c) => c.url !== '' && !isValidChannelUrl(c.url))} title="Подписка на канал" description="По умолчанию канал только предлагается (бонус, задание, пробный период) и вход не блокируется — так удобнее людям. Жёсткий режим закрывает бот, Mini App и сайт до подписки.">
      {(v, set) => (<>
        <Toggle label="Включить проверку канала" checked={v.enabled} onChange={(x) => set('enabled', x)} />
        <Toggle label="Жёстко: без подписки ничего не работает (не рекомендуется — раздражает людей)" checked={v.mode === 'hard'} onChange={(x) => set('mode', x ? 'hard' : 'soft')} />
        <div className="rounded-btn bg-surface-2 p-3.5 text-sm text-muted">
          Добавьте бота{botUsername ? ` @${botUsername}` : ''} <b className="text-fg">администратором</b> в канал или чат — иначе Telegram не даст проверить подписку. Если проверка невозможна (бот не админ, неверный адрес), пользователей мы не блокируем — но вы увидите проблему в мониторинге.
        </div>
        <div className="space-y-3">
          {(v.chats as { chat: string; title: string; url: string }[]).map((c, i) => (
            <div key={i} className="grid gap-3 rounded-btn border border-border p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
              <Field label="Канал/чат" hint="@username или -100…"><Input value={c.chat} onChange={(e) => set('chats', v.chats.map((x: any, j: number) => (j === i ? { ...x, chat: e.target.value.trim() } : x)))} placeholder="@my_channel" /></Field>
              <Field label="Название на кнопке"><Input value={c.title} onChange={(e) => set('chats', v.chats.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Наш канал" /></Field>
              <Field label="Ссылка" hint="Например https://t.me/mychannel. Для приватных каналов — инвайт-ссылка. «@имя» превратится в ссылку сама." error={c.url && !isValidChannelUrl(c.url) ? 'Ссылка должна начинаться с https://, http:// или tg:// — например https://t.me/mychannel' : undefined}><Input value={c.url} onChange={(e) => set('chats', v.chats.map((x: any, j: number) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} onBlur={() => { const n = normalizeChannelUrl(c.url); if (n !== c.url) set('chats', v.chats.map((x: any, j: number) => (j === i ? { ...x, url: n } : x))); }} placeholder="https://t.me/mychannel" /></Field>
              <div className="flex items-end"><Button type="button" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => set('chats', v.chats.filter((_: any, j: number) => j !== i))} /></div>
            </div>
          ))}
          {v.chats.length < 5 && <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set('chats', [...v.chats, { chat: '', title: '', url: '' }])}>Добавить канал</Button>}
        </div>
        <Field label="Текст на экране подписки"><Input value={v.text} maxLength={400} onChange={(e) => set('text', e.target.value)} /></Field>
      </>)}
    </GroupForm>
  );
}

function Topup({ s, locked }: { s: Record<string, any>; locked: boolean }) {
  return (
    <GroupForm group="topup" data={s.topup} locked={locked} title="Пополнение баланса" description="Пределы суммы, быстрые кнопки и бонусы за крупные пополнения.">
      {(v, set) => (<>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Минимум, ₽"><Input type="number" min={10} value={v.min / 100} onChange={(e) => set('min', toKop(e.target.value))} /></Field>
          <Field label="Максимум, ₽"><Input type="number" min={100} value={v.max / 100} onChange={(e) => set('max', toKop(e.target.value))} /></Field>
        </div>
        <Field label="Быстрые суммы, ₽" hint="Через запятую, до 8 значений"><Input value={(v.presets as number[]).map((x) => x / 100).join(', ')} onChange={(e) => set('presets', e.target.value.split(',').map((x) => toKop(x)).filter((x) => x >= 1000).slice(0, 8))} /></Field>
        <div>
          <div className="mb-2 text-sm font-medium">Бонусы к пополнению</div>
          <div className="space-y-2">
            {(v.bonuses as { from: number; percent: number }[]).map((b, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <Field label="От суммы, ₽"><Input type="number" min={1} value={b.from / 100} onChange={(e) => set('bonuses', v.bonuses.map((x: any, j: number) => (j === i ? { ...x, from: toKop(e.target.value) } : x)))} /></Field>
                <Field label="Бонус, %"><Input type="number" min={1} max={100} value={b.percent} onChange={(e) => set('bonuses', v.bonuses.map((x: any, j: number) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} /></Field>
                <Button type="button" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => set('bonuses', v.bonuses.filter((_: any, j: number) => j !== i))} />
              </div>
            ))}
            {v.bonuses.length < 6 && <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set('bonuses', [...v.bonuses, { from: 50000, percent: 5 }])}>Добавить ступень</Button>}
          </div>
        </div>
      </>)}
    </GroupForm>
  );
}

function Features({ s, locked }: { s: Record<string, any>; locked: boolean }) {
  return (
    <div className="space-y-5">
      <GroupForm group="addons" data={s.addons} locked={locked} title="Докупки и автопродление" description="Товары (устройства и трафик LTE) создаются на странице «Докупки».">
        {(v, set) => (<>
          <Toggle label="Докупки включены" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <Toggle label="Разрешить автопродление с баланса" hint="Клиент включает сам; за 3 дня до конца тариф продлевается с баланса" checked={v.auto_renew_enabled} onChange={(x) => set('auto_renew_enabled', x)} />
        </>)}
      </GroupForm>
      <GroupForm group="quests" data={s.quests} locked={locked} title="Квесты" description="Сами задания настраиваются на странице «Квесты».">
        {(v, set) => (<>
          <Toggle label="Квесты включены" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <Field label="Надбавка за день серии, ₽" hint="К ежедневному бонусу за каждый день подряд (максимум 6 дней)"><Input type="number" min={0} step={0.5} value={v.streak_step / 100} onChange={(e) => set('streak_step', toKop(e.target.value))} /></Field>
          <Toggle label="Достижения за задания" hint="За серии и количество выполненных заданий пользователь получает достижение и бонусные дни" checked={v.achievements !== false} onChange={(x) => set('achievements', x)} />
        </>)}
      </GroupForm>
    </div>
  );
}

function Monitoring({ s, locked }: { s: Record<string, any>; locked: boolean }) {
  return (
    <GroupForm group="monitoring" data={s.monitoring} locked={locked} title="Автомониторинг" description="Раз в минуту проверяем Remnawave, ноды, платёжные системы, Telegram и очередь выдачи оплаченных заказов.">
      {(v, set) => (<>
        <Toggle label="Мониторинг включён" checked={v.enabled} onChange={(x) => set('enabled', x)} />
        <Toggle label="Уведомлять в Telegram" hint="Получают администраторы с привязанным Telegram ID" checked={v.alerts} onChange={(x) => set('alerts', x)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Дополнительный чат для алертов" hint="ID группы/канала (бот должен быть в нём)"><Input value={v.extra_chat_id} onChange={(e) => set('extra_chat_id', e.target.value.trim())} placeholder="-1001234567890" /></Field>
          <Field label="Интервал проверок, секунды" hint="От 60 до 3600 секунд"><Input type="number" min={60} max={3600} value={v.interval_seconds ?? 60} onChange={num(set, 'interval_seconds')} /></Field>
          <Field label="Порог ошибок подряд" hint="Сколько неудач подряд считаются аварией (1–10)"><Input type="number" min={1} max={10} value={v.fail_threshold} onChange={num(set, 'fail_threshold')} /></Field>
        </div>
        <Toggle label="Автоматические техработы" hint="Если Remnawave недоступна — временно блокируем покупки; снимаем, когда она вернётся" checked={v.auto_maintenance} onChange={(x) => set('auto_maintenance', x)} />
      </>)}
    </GroupForm>
  );
}

function Appearance({ s, locked }: { s: Record<string, any>; locked: boolean }) {
  return (
    <GroupForm group="appearance" data={s.appearance} locked={locked} title="Оформление приложения" description="Общая тема для всех пользователей Mini App. Админ-панель сохраняет своё оформление.">
      {(v, set) => (<>
        <DesignPicker value={resolveMiniAppDesign(v.miniapp_design)} onChange={id => set('miniapp_design', id)} />
        <Field label="Баннер в приложении" hint="Короткое объявление над страницами (пусто — скрыть)"><Input value={v.banner_text} maxLength={200} onChange={(e) => set('banner_text', e.target.value)} placeholder="Новости и предложения VAYLO" /></Field>
        <p className="text-xs leading-relaxed text-muted">У каждой темы своя согласованная палитра. Отдельный акцентный цвет старого оформления не применяется к новым темам.</p>
      </>)}
    </GroupForm>
  );
}

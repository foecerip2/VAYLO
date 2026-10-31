import { Badge, Button, Card, CopyField, Field, Input, Select, Switch, Tabs, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { GroupForm, Toggle, errMsg } from '../components/GroupForm';
import { PageTitle, Section } from '../components/kit';
import { MoreTabs, type MoreTab } from './SettingsMore';
import { ApiError, del, get, post, put, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { isUuid } from '@vpn/shared';

type Tab = 'payments' | 'remnawave' | 'general' | 'growth' | MoreTab | 'security' | 'admins';
interface SettingsResp { settings: Record<string, any>; webhooks: { yookassa: string; platega: string; rollypay: string }; env: { remnawaveFromEnv: boolean; botUsername: string; botConfigured: boolean }; mask: string }

const ROLLY_METHODS = [
  { id: 'any', label: 'Все способы одной кнопкой', hint: 'СБП, карта и крипта — клиент выбирает на странице RollyPay' },
  { id: 'sbp', label: 'СБП', hint: 'Отдельная кнопка «СБП»' },
  { id: 'card', label: 'Банковская карта', hint: 'Visa, Mastercard, Мир' },
  { id: 'crypto', label: 'Криптовалюта', hint: 'USDT, BTC, ETH и др.' },
];

const METHODS = [
  { id: 'sbp', label: 'СБП (QR)' },
  { id: 'card_acquiring', label: 'Банковские карты (эквайринг)' },
  { id: 'cards_rub', label: 'Карты РФ' },
  { id: 'international', label: 'Международные карты' },
  { id: 'crypto', label: 'Криптовалюта' },
];

function Payments({ s, webhooks, locked }: { s: SettingsResp; webhooks: SettingsResp['webhooks']; locked: boolean }) {
  return (
    <div className="space-y-5">
      <GroupForm group="yookassa" data={s.settings.yookassa} locked={locked} title="ЮKassa" description="Карты, СБП, SberPay, ЮMoney. Магазин создаётся в личном кабинете yookassa.ru." testTarget="yookassa" right={<Badge tone={s.settings.yookassa.enabled ? 'success' : 'neutral'}>{s.settings.yookassa.enabled ? 'Включена' : 'Выключена'}</Badge>}>
        {(v, set) => (<>
          <Toggle label="Принимать оплату через ЮKassa" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="shopId"><Input value={v.shop_id} onChange={(e) => set('shop_id', e.target.value.trim())} placeholder="123456" autoComplete="off" /></Field>
            <Field label="Секретный ключ" hint="Хранится в зашифрованном виде"><Input type="password" value={v.secret_key} onChange={(e) => set('secret_key', e.target.value.trim())} placeholder="live_…" autoComplete="new-password" /></Field>
          </div>
          <Toggle label="Отправлять чек (54-ФЗ)" hint="Включите, если подключена онлайн-касса в ЮKassa" checked={v.send_receipt} onChange={(x) => set('send_receipt', x)} />
          {v.send_receipt && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email для чека" hint="Если у клиента нет email"><Input type="email" value={v.receipt_email} onChange={(e) => set('receipt_email', e.target.value)} placeholder="shop@example.com" /></Field>
            <Field label="Ставка НДС"><Select value={v.vat_code} onChange={(e) => set('vat_code', Number(e.target.value))}><option value={1}>Без НДС</option><option value={2}>0%</option><option value={3}>10%</option><option value={4}>20%</option><option value={5}>10/110</option><option value={6}>20/120</option></Select></Field>
          </div>}
          <div className="rounded-btn bg-surface-2 p-3.5">
            <div className="mb-2 text-sm font-medium">Адрес для уведомлений (HTTP-уведомления)</div>
            <CopyField value={webhooks.yookassa} />
            <p className="mt-2 text-xs text-muted">В ЮKassa: Интеграция → HTTP-уведомления → вставьте адрес и отметьте события «payment.succeeded» и «payment.canceled».</p>
          </div>
        </>)}
      </GroupForm>

      <GroupForm group="platega" data={s.settings.platega} locked={locked} title="Platega" description="СБП, карты, международные карты и крипта. Кабинет: platega.io." testTarget="platega" right={<Badge tone={s.settings.platega.enabled ? 'success' : 'neutral'}>{s.settings.platega.enabled ? 'Включена' : 'Выключена'}</Badge>}>
        {(v, set) => (<>
          <Toggle label="Принимать оплату через Platega" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Merchant ID (X-MerchantId)"><Input value={v.merchant_id} onChange={(e) => set('merchant_id', e.target.value.trim())} autoComplete="off" /></Field>
            <Field label="Секретный ключ (X-Secret)" hint="Хранится в зашифрованном виде"><Input type="password" value={v.secret} onChange={(e) => set('secret', e.target.value.trim())} autoComplete="new-password" /></Field>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Способы оплаты для клиентов</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {METHODS.map((m) => {
                const on = (v.methods as string[]).includes(m.id);
                return <label key={m.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-btn border px-3.5 text-sm transition ${on ? 'border-primary bg-primary/8' : 'border-border'}`}><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={on} onChange={(e) => set('methods', e.target.checked ? [...v.methods, m.id] : v.methods.filter((x: string) => x !== m.id))} />{m.label}</label>;
              })}
            </div>
          </div>
          <div className="rounded-btn bg-surface-2 p-3.5">
            <div className="mb-2 text-sm font-medium">Callback URL</div>
            <CopyField value={webhooks.platega} />
            <p className="mt-2 text-xs text-muted">Укажите этот адрес в настройках магазина Platega как адрес для callback-уведомлений.</p>
          </div>
        </>)}
      </GroupForm>
      <GroupForm group="rollypay" data={s.settings.rollypay} locked={locked} title="RollyPay" description="СБП, карты РФ и криптовалюта. Деньги приходят на кассу в USDT. Кабинет: rollypay.io." testTarget="rollypay" right={<Badge tone={s.settings.rollypay.enabled ? 'success' : 'neutral'}>{s.settings.rollypay.enabled ? 'Включена' : 'Выключена'}</Badge>}>
        {(v, set) => (<>
          <Toggle label="Принимать оплату через RollyPay" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <div className="rounded-btn border border-primary/25 bg-primary/[.06] p-3.5 text-sm">
            <div className="mb-1.5 font-semibold">Как подключить за 5 минут</div>
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>В кабинете RollyPay создайте <b className="text-fg">кассу (терминал)</b>.</li>
              <li>В разделе «Интеграция» скопируйте <b className="text-fg">Terminal ID</b>, <b className="text-fg">API-ключ</b> (виден только при выпуске, потеряли — «Перевыпустить») и <b className="text-fg">секрет подписи вебхуков</b> — вставьте ниже.</li>
              <li>В «Интеграция кассы» → «Адрес для вебхуков» укажите <b className="text-fg">Callback URL</b> из блока ниже (целиком, до <code>/webhooks/rollypay</code>).</li>
              <li>Включите переключатель, нажмите «Проверить подключение», затем сделайте тестовый платёж в режиме «Тест».</li>
            </ol>
          </div>
          <Field label="Terminal ID" hint="Кабинет RollyPay → Интеграция → Terminal ID"><Input value={v.terminal_id} onChange={(e) => set('terminal_id', e.target.value.trim())} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API-ключ (X-API-Key)" hint="Хранится в зашифрованном виде"><Input type="password" value={v.api_key} onChange={(e) => set('api_key', e.target.value.trim())} placeholder="rpk_live_…" autoComplete="new-password" /></Field>
            <Field label="Секрет подписи (signing_secret)" hint="Нужен для проверки callback. Хранится зашифрованно"><Input type="password" value={v.signing_secret} onChange={(e) => set('signing_secret', e.target.value.trim())} autoComplete="new-password" /></Field>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Кнопки оплаты для клиентов</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLLY_METHODS.map((m) => {
                const on = (v.methods as string[]).includes(m.id);
                return (
                  <label key={m.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-btn border px-3.5 py-2 text-sm transition ${on ? 'border-primary bg-primary/8' : 'border-border'}`}>
                    <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={on} onChange={(e) => { const next = e.target.checked ? [...v.methods, m.id] : v.methods.filter((x: string) => x !== m.id); if (next.length) set('methods', next); }} />
                    <span className="min-w-0"><span className="block font-medium leading-tight">{m.label}</span><span className="block text-xs text-muted">{m.hint}</span></span>
                  </label>
                );
              })}
            </div>
          </div>
          <Toggle label="Тестовый режим" hint="Платежи создаются с пометкой test: деньги не списываются, подтверждать оплату нужно кнопками на тестовой странице RollyPay" checked={v.test_mode} onChange={(x) => set('test_mode', x)} />
          {v.test_mode && v.enabled && <p className="rounded-xl bg-warning/10 p-3 text-xs text-warning">Включён тестовый режим — реальные оплаты не проходят. Не забудьте выключить перед запуском.</p>}
          <div className="rounded-btn bg-surface-2 p-3.5">
            <div className="mb-2 text-sm font-medium">Callback URL</div>
            <CopyField value={webhooks.rollypay} />
            <p className="mt-2 text-xs text-muted">Укажите этот адрес в настройках кассы RollyPay. Уведомления подписаны (HMAC-SHA256), а статус платежа мы дополнительно сверяем запросом к API.</p>
          </div>
          <details className="rounded-btn bg-surface-2 p-3.5 text-sm">
            <summary className="cursor-pointer font-medium">Дополнительно</summary>
            <div className="mt-3"><Field label="Адрес API" hint="Оставьте пустым — используется https://api.rollypay.io/api/v1"><Input value={v.api_base} onChange={(e) => set('api_base', e.target.value.trim())} placeholder="https://api.rollypay.io/api/v1" /></Field></div>
          </details>
        </>)}
      </GroupForm>
      <Card className="p-4 text-sm text-muted">Оплата с баланса и промокоды работают всегда. Если не включена ни одна платёжная система, клиенты смогут платить только с баланса.</Card>
    </div>
  );
}

/** Выбор Internal Squad: список из панели; если список недоступен — ручной ввод UUID с проверкой формата */
function SquadField({ value, onChange, enabled }: { value: string; onChange: (v: string) => void; enabled: boolean }) {
  const squads = useQuery({ queryKey: ['squads'], queryFn: () => get<{ uuid: string; name: string }[]>('/squads'), enabled, retry: false });
  const hint = 'В какую группу добавлять новых пользователей. «— автоматически —» — первая найденная.';
  if (squads.data?.length) {
    const known = squads.data.some((x) => x.uuid === value);
    return (
      <Field label="Internal Squad" hint={hint}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— автоматически —</option>
          {value && !known && <option value={value}>Неизвестная группа ({value.slice(0, 8)}…)</option>}
          {squads.data.map((x) => <option key={x.uuid} value={x.uuid}>{x.name}</option>)}
        </Select>
      </Field>
    );
  }
  const bad = value !== '' && !isUuid(value);
  return (
    <Field label="UUID Internal Squad" hint={squads.isError ? 'Не удалось получить список групп — укажите UUID вручную. Пусто — первая найденная.' : 'Список групп появится после сохранения адреса и токена. Можно указать UUID вручную. Пусто — первая найденная.'} error={bad ? 'Некорректный UUID — ожидается формат 00000000-0000-0000-0000-000000000000' : undefined}>
      <Input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="00000000-0000-0000-0000-000000000000" />
    </Field>
  );
}

interface RestoreSt { running: boolean; dryRun: boolean; total: number; done: number; created: number; existed: number; linkChanged: number; failed: number; errors: string[]; warnings: string[]; panel: { nodes: number; squads: number; squadName?: string } | null; fatal?: string; finishedAt: string | null; startedAt: string | null; oldSubHost: string | null }

/** Восстановление пользователей в новой панели Remnawave из базы VAYLO */
function RestoreBlock({ locked }: { locked: boolean }) {
  const toast = useToast();
  const [expired, setExpired] = useState(false);
  const st = useQuery({ queryKey: ['rw-restore'], queryFn: () => get<RestoreSt>('/remnawave/restore'), refetchInterval: (q) => (q.state.data?.running ? 1500 : false) });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => post<RestoreSt>('/remnawave/restore', { dryRun, includeExpired: expired }),
    onSuccess: () => void st.refetch(),
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const s = st.data;
  const pct = s && s.total ? Math.round((s.done / s.total) * 100) : 0;
  const finished = s && !s.running && s.startedAt;
  return (
    <Section title="Восстановление после переустановки панели" description="Если панель Remnawave пришлось поднять заново, верните в неё всех пользователей из базы VAYLO: с теми же сроками, лимитами и ссылками подписки.">
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Поднимите новую панель, добавьте ноды и создайте внутренний сквад с профилем подключения.</li>
          <li>Выше укажите адрес и новый API-токен панели, выберите основной сквад (UUID у нового сквада другой), сохраните и нажмите «Проверить подключение».</li>
          <li>В новой панели задайте <code>SUB_PUBLIC_DOMAIN</code> тем же, что был раньше{s?.oldSubHost ? <>: <code className="break-all text-fg">{s.oldSubHost.replace(/\/$/, '')}</code></> : ''} — тогда ссылки у клиентов продолжат работать.</li>
          <li>Нажмите «Проверить» (ничего не создаёт), затем «Восстановить».</li>
        </ol>
        <label className="flex items-center gap-3 text-sm"><Switch checked={expired} onChange={setExpired} label="Включая истёкшие" /><span>Восстановить и пользователей с истёкшей подпиской</span></label>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={locked || s?.running} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>Проверить</Button>
          <Button disabled={locked || s?.running} loading={run.isPending && run.variables === false} onClick={() => confirm('Создать пользователей в панели Remnawave из базы VAYLO?\nУже существующие в панели не дублируются.') && run.mutate(false)}>Восстановить пользователей</Button>
        </div>
        {s?.fatal && <p className="break-words rounded-xl bg-danger/10 p-3 text-sm text-danger">{s.fatal}</p>}
        {s && s.startedAt && !s.fatal && (
          <div className="space-y-3 rounded-2xl border border-fg/10 bg-fg/[.04] p-4 text-sm">
            <div className="flex items-center justify-between gap-2"><b>{s.dryRun ? 'Проверка' : 'Восстановление'}</b><Badge tone={s.running ? 'primary' : s.failed ? 'warning' : 'success'}>{s.running ? 'Идёт…' : s.failed ? 'Есть ошибки' : 'Готово'}</Badge></div>
            {s.panel && <div className="text-xs text-muted">Панель: нод {s.panel.nodes}, сквадов {s.panel.squads}{s.panel.squadName ? ` · основной сквад «${s.panel.squadName}»` : ''}</div>}
            {s.running && <div className="h-1.5 overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-2 transition-all" style={{ width: `${pct}%` }} /></div>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['К восстановлению', s.total], ['Создано', s.created], ['Уже были', s.existed], ['Ошибок', s.failed]].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-fg/[.05] p-2.5"><div className="text-xs text-muted">{l}</div><div className="num text-lg font-bold">{v}</div></div>)}
            </div>
            {s.dryRun && finished && <p className="text-muted">Это только проверка: никто не создан. Если цифры верны, нажмите «Восстановить пользователей».</p>}
            {!s.dryRun && finished && s.linkChanged > 0 && <p className="rounded-xl bg-warning/10 p-3 text-warning">У {s.linkChanged} пользователей ссылка подписки изменилась (панель не приняла прежнюю) — им нужно обновить подписку в приложении.</p>}
            {s.warnings.map((w) => <p key={w} className="rounded-xl bg-warning/10 p-3 text-xs text-warning">{w}</p>)}
            {s.errors.length > 0 && <details className="text-xs text-muted"><summary className="cursor-pointer">Ошибки ({s.failed})</summary><ul className="mt-2 space-y-1 break-words">{s.errors.map((e) => <li key={e}>{e}</li>)}</ul></details>}
          </div>
        )}
      </div>
    </Section>
  );
}

function RemnawaveTab({ s, locked }: { s: SettingsResp; locked: boolean }) {
  return (
    <div className="space-y-5">
    <GroupForm group="remnawave" data={s.settings.remnawave} locked={locked} title="Подключение к Remnawave" description="Панель, которая выдаёт подписки и управляет нодами." testTarget="remnawave" testLabel="Проверить подключение" invalid={(v) => Boolean(v.squad_uuid) && !isUuid(v.squad_uuid)}>
      {(v, set) => (<>
        {s.env.remnawaveFromEnv && <div className="rounded-btn bg-primary/8 p-3 text-sm">Адрес и токен заданы при установке (файл .env). Поля ниже переопределяют их — оставьте пустыми, чтобы использовать значения из .env.</div>}
        <Field label="Адрес панели" hint="Для установки на одном сервере — внутренний адрес, например http://remnawave:3000"><Input value={v.url} onChange={(e) => set('url', e.target.value.trim())} placeholder="https://panel.example.com" /></Field>
        <Field label="API-токен" hint="Remnawave → Настройки → API-токены"><Input type="password" value={v.token} onChange={(e) => set('token', e.target.value.trim())} autoComplete="new-password" /></Field>
        <SquadField value={v.squad_uuid ?? ''} onChange={(x) => set('squad_uuid', x)} enabled={!locked} />
      </>)}
    </GroupForm>
    <RestoreBlock locked={locked} />
    </div>
  );
}

function General({ s, locked }: { s: SettingsResp; locked: boolean }) {
  return (
    <GroupForm group="general" data={s.settings.general} locked={locked} title="Основное">
      {(v, set) => (<>
        <Field label="Название сервиса"><Input value={v.brand_name} maxLength={40} onChange={(e) => set('brand_name', e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ссылка на поддержку" hint="https://t.me/…"><Input value={v.support_url} onChange={(e) => set('support_url', e.target.value.trim())} /></Field>
          <Field label="Username поддержки" hint="Если ссылки нет: @support_bot"><Input value={v.support_username} onChange={(e) => set('support_username', e.target.value.trim())} /></Field>
          <Field label="Ссылка на канал"><Input value={v.channel_url} onChange={(e) => set('channel_url', e.target.value.trim())} /></Field>
          <Field label="Ссылка на условия использования"><Input value={v.terms_url} onChange={(e) => set('terms_url', e.target.value.trim())} /></Field>
        </div>
        <Field label="Приветствие" hint="Показывается на главной в боте и приложении (необязательно)"><Input value={v.welcome_text} maxLength={600} onChange={(e) => set('welcome_text', e.target.value)} /></Field>
        <Toggle label="Технические работы" hint="Клиенты увидят уведомление, покупки и пополнения отключатся" checked={v.maintenance} onChange={(x) => set('maintenance', x)} />
        {v.maintenance && <Field label="Текст уведомления о работах"><Input value={v.maintenance_text} maxLength={300} onChange={(e) => set('maintenance_text', e.target.value)} /></Field>}
      </>)}
    </GroupForm>
  );
}

function Growth({ s, locked }: { s: SettingsResp; locked: boolean }) {
  const num = (set: (k: string, v: unknown) => void, k: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === '' ? 0 : Number(e.target.value));
  return (
    <div className="space-y-5">
      <GroupForm group="trial" data={s.settings.trial} locked={locked} title="Пробный период">
        {(v, set) => (<>
          <Toggle label="Выдавать пробный период новым пользователям" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Дней"><Input type="number" min={1} value={v.days} onChange={num(set, 'days')} /></Field>
            <Field label="Трафик, ГБ" hint="0 — безлимит"><Input type="number" min={0} value={v.traffic_gb} onChange={num(set, 'traffic_gb')} /></Field>
            <Field label="Устройств"><Input type="number" min={0} value={v.device_limit} onChange={num(set, 'device_limit')} /></Field>
          </div>
          <Toggle label="Пробный период только после подписки на канал" hint="Нужны настроенные каналы во вкладке «Подписка на канал»" checked={v.require_channel} onChange={(x) => set('require_channel', x)} />
        </>)}
      </GroupForm>
      <GroupForm group="referral" data={s.settings.referral} locked={locked} title="Реферальная программа" description="2 уровня, ранги (настраиваются на странице «Рефералы») и партнёрские ссылки.">
        {(v, set) => (<>
          <Toggle label="Реферальная программа включена" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <Toggle label="Пользователь сам выбирает награду: дни или деньги" hint="Дни — только за первую оплату друга. Деньги — процент идёт на отдельный реферальный счёт (вывод или перевод на баланс). Выключите, чтобы начислять и дни, и деньги на основной баланс, как раньше" checked={v.choice_enabled} onChange={(x) => set('choice_enabled', x)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Бонусные дни (режим «дни»)" hint="За первую оплату друга, 0 — не начислять"><Input type="number" min={0} value={v.days} onChange={num(set, 'days')} /></Field>
            <Field label="Процент с оплат (режим «деньги»), %" hint="От суммы платежа, 0 — не начислять"><Input type="number" min={0} max={100} value={v.percent} onChange={num(set, 'percent')} /></Field>
            <Field label="Процент 2 уровня, %" hint="Друзья ваших друзей, 0 — выключено"><Input type="number" min={0} max={100} value={v.level2_percent} onChange={num(set, 'level2_percent')} /></Field>
            <Field label="Бонусные дни 2 уровня" hint="За первую оплату друга друга, 0 — не начислять. Например: 1 уровень 7 дней / 20%, 2 уровень 3 дня / 10%"><Input type="number" min={0} max={365} value={v.level2_days ?? 0} onChange={num(set, 'level2_days')} /></Field>
          </div>
          <Toggle label="Процент с каждой оплаты друга" hint="Иначе — только с первой (дни всегда только за первую)" checked={v.recurring} onChange={(x) => set('recurring', x)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Бонус приглашённому при регистрации, ₽" hint="На баланс, 0 — нет"><Input type="number" min={0} value={v.signup_bonus_invitee / 100} onChange={(e) => set('signup_bonus_invitee', Math.round(Number(e.target.value || 0) * 100))} /></Field>
            <Field label="Бонус пригласившему за регистрацию, ₽" hint="На баланс, 0 — нет"><Input type="number" min={0} value={v.signup_bonus_referrer / 100} onChange={(e) => set('signup_bonus_referrer', Math.round(Number(e.target.value || 0) * 100))} /></Field>
          </div>
        </>)}
      </GroupForm>
      <GroupForm group="withdraw" data={s.settings.withdraw} locked={locked} title="Вывод реферальных денег" description="Заявки приходят в раздел «Выводы» и в Telegram админам. Деньги выплачиваете вы сами (карта, СБП, USDT), затем нажимаете «Выплачено».">
        {(v, set) => (<>
          <Toggle label="Вывод включён" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Минимальная сумма вывода, ₽"><Input type="number" min={1} value={v.min / 100} onChange={(e) => set('min', Math.round(Number(e.target.value || 0) * 100))} /></Field>
            <Field label="Комиссия вывода, %"><Input type="number" min={0} max={50} value={v.fee_percent} onChange={num(set, 'fee_percent')} /></Field>
            <Field label="Бонус при переводе на баланс, %" hint="Если пользователь тратит заработанное на подписку — это выгоднее вам и ему"><Input type="number" min={0} max={100} value={v.transfer_bonus_percent} onChange={num(set, 'transfer_bonus_percent')} /></Field>
            <Field label="Доступные способы выплаты" hint="Показывается пользователю при выводе"><Input value={v.methods} maxLength={200} onChange={(e) => set('methods', e.target.value)} /></Field>
          </div>
        </>)}
      </GroupForm>
    </div>
  );
}

function Security() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [offPw, setOffPw] = useState('');
  const start = useMutation({ mutationFn: () => post<{ secret: string; uri: string }>('/me/2fa/setup'), onSuccess: setSetup, onError: (e) => toast(errMsg(e), 'error') });
  const enable = useMutation({ mutationFn: () => post('/me/2fa/enable', { code }), onSuccess: async () => { setSetup(null); setCode(''); await refresh(); toast('Двухфакторная защита включена', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const disable = useMutation({ mutationFn: () => post('/me/2fa/disable', { password: offPw }), onSuccess: async () => { setOffPw(''); await refresh(); toast('2FA отключена', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const change = useMutation({ mutationFn: () => post<{ accessToken?: string }>('/me/password', pw), onSuccess: (r) => { if (r.accessToken) setToken(r.accessToken); setPw({ current: '', next: '' }); toast('Пароль изменён', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const { logout } = useAuth();
  const outAll = useMutation({ mutationFn: () => post('/auth/logout-all'), onSuccess: () => logout(), onError: (e) => toast(errMsg(e), 'error') });
  return (
    <div className="space-y-5">
      <Section title="Двухфакторная аутентификация" description="Код из приложения (Google Authenticator, Aegis и т.п.) при входе." right={<Badge tone={me?.totpEnabled ? 'success' : 'warning'}>{me?.totpEnabled ? 'Включена' : 'Выключена'}</Badge>}>
        {me?.totpEnabled ? (
          <div className="flex max-w-md flex-col gap-3 sm:flex-row"><Input type="password" placeholder="Пароль для отключения" value={offPw} onChange={(e) => setOffPw(e.target.value)} /><Button variant="danger" loading={disable.isPending} disabled={!offPw} onClick={() => disable.mutate()}>Отключить</Button></div>
        ) : setup ? (
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="w-fit rounded-card bg-white p-3"><QRCodeSVG value={setup.uri} size={168} /></div>
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-sm text-muted">Отсканируйте QR-код или введите ключ вручную, затем введите 6-значный код.</p>
              <CopyField value={setup.secret} />
              <div className="flex gap-3"><Input inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-[160px] tabular" /><Button loading={enable.isPending} disabled={code.length !== 6} onClick={() => enable.mutate()}>Включить</Button></div>
            </div>
          </div>
        ) : <Button loading={start.isPending} onClick={() => start.mutate()}>Настроить 2FA</Button>}
      </Section>
      <Section title="Смена пароля">
        <form className="grid max-w-xl gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          <Field label="Текущий пароль"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Новый пароль" hint="Минимум 10 символов"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <div><Button type="submit" loading={change.isPending} disabled={!pw.current || pw.next.length < 10}>Изменить пароль</Button></div>
        </form>
        <p className="mt-3 text-xs text-muted">После смены пароля все остальные устройства выйдут из админки автоматически.</p>
      </Section>
      <Section title="Сессии" description="«Запомнить меня» держит вход 30 дней и продлевается, пока вы работаете. Если входили с чужого устройства — завершите все сессии.">
        <Button variant="danger" loading={outAll.isPending} onClick={() => { if (confirm('Выйти на всех устройствах, включая это?')) outAll.mutate(); }}>Выйти на всех устройствах</Button>
      </Section>
    </div>
  );
}

interface AdminRow { id: string; email: string; role: string; totp_enabled: boolean; tg_id: number | null; last_login_at: string | null }
const ROLE_LABEL: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', support: 'Поддержка', analyst: 'Аналитик' };
function Admins() {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admins'], queryFn: () => get<AdminRow[]>('/admins') });
  const [f, setF] = useState({ email: '', password: '', role: 'support', tgId: '' });
  const create = useMutation({ mutationFn: () => post('/admins', { email: f.email, password: f.password, role: f.role, tgId: f.tgId ? Number(f.tgId) : null }), onSuccess: () => { setF({ email: '', password: '', role: 'support', tgId: '' }); void qc.invalidateQueries({ queryKey: ['admins'] }); toast('Администратор добавлен', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const setTg = useMutation({ mutationFn: (v: { id: string; tgId: number | null }) => put(`/admins/${v.id}/telegram`, { tgId: v.tgId }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admins'] }); toast('Telegram ID сохранён', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const remove = useMutation({ mutationFn: (id: string) => del(`/admins/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admins'] }), onError: (e) => toast(errMsg(e), 'error') });
  return (
    <div className="space-y-5">
      <Section title="Администраторы">
        <div className="divide-y divide-border">
          {q.data?.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0"><div className="truncate font-medium">{a.email}{a.id === me?.id && <span className="ml-2 text-xs text-muted">(вы)</span>}</div><div className="text-xs text-muted">Вход: {fmtDateTime(a.last_login_at)} · 2FA: {a.totp_enabled ? 'да' : 'нет'} · Telegram: {a.tg_id ?? 'не привязан'}</div></div>
              <div className="flex items-center gap-2"><Button size="sm" variant="secondary" onClick={() => { const v = prompt('Telegram ID администратора (число). Пусто — отвязать.', a.tg_id ? String(a.tg_id) : ''); if (v === null) return; const n = v.trim() === '' ? null : Number(v); if (n !== null && (!Number.isInteger(n) || n <= 0)) return toast('Нужен числовой Telegram ID', 'error'); setTg.mutate({ id: a.id, tgId: n }); }}>Telegram</Button><Badge tone={a.role === 'owner' ? 'primary' : 'neutral'}>{ROLE_LABEL[a.role] ?? a.role}</Badge>{a.id !== me?.id && <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => confirm(`Удалить ${a.email}?`) && remove.mutate(a.id)} />}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Добавить администратора" description="Поддержка — пользователи и платежи; Аналитик — только просмотр; Администратор — всё, кроме настроек и админов.">
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Пароль" hint="Минимум 10 символов"><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
          <Field label="Telegram ID" hint="Для админ-меню в боте и Mini App"><Input inputMode="numeric" value={f.tgId} onChange={(e) => setF({ ...f, tgId: e.target.value.replace(/\D/g, '') })} placeholder="необязательно" /></Field>
          <Field label="Роль"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <div><Button type="submit" loading={create.isPending} disabled={!f.email || f.password.length < 10}>Добавить</Button></div>
        </form>
      </Section>
    </div>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const owner = can('owner');
  const [tab, setTab] = useState<Tab>('payments');
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<SettingsResp>('/settings') });
  const items: { value: Tab; label: string }[] = [
    { value: 'payments', label: 'Платежи' }, { value: 'remnawave', label: 'Remnawave' }, { value: 'general', label: 'Основное' }, { value: 'growth', label: 'Пробный и рефералы' }, { value: 'gate', label: 'Подписка на канал' }, { value: 'topup', label: 'Пополнение' }, { value: 'features', label: 'Докупки и квесты' }, { value: 'notifications', label: 'Уведомления' }, { value: 'monitoring', label: 'Мониторинг' }, { value: 'appearance', label: 'Оформление' }, { value: 'security', label: 'Безопасность' },
    ...(owner ? [{ value: 'admins' as Tab, label: 'Администраторы' }] : []),
  ];
  const locked = !owner;
  return (
    <div className="animate-fade-up">
      <PageTitle title="Настройки" />
      {locked && <Card className="mb-4 p-3.5 text-sm text-muted">Изменять настройки может только владелец.</Card>}
      <div className="mb-5"><Tabs value={tab} onChange={setTab} items={items} /></div>
      {tab === 'security' ? <Security /> : tab === 'admins' ? <Admins /> : q.isLoading || !q.data ? <div className="text-muted">Загрузка…</div> : (
        <>
          {tab === 'payments' && <Payments s={q.data} webhooks={q.data.webhooks} locked={locked} />}
          {tab === 'remnawave' && <RemnawaveTab s={q.data} locked={locked} />}
          {tab === 'general' && <General s={q.data} locked={locked} />}
          {tab === 'growth' && <Growth s={q.data} locked={locked} />}
          {(tab === 'gate' || tab === 'topup' || tab === 'features' || tab === 'notifications' || tab === 'monitoring' || tab === 'appearance') && <MoreTabs tab={tab} s={q.data.settings} botUsername={q.data.env.botUsername} locked={locked} />}
        </>
      )}
    </div>
  );
}

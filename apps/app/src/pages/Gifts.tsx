import { Button, Card, CopyField, ErrorState, Input, Sheet, Skeleton, Tabs, Textarea, useToast } from '@vpn/ui';
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, Gift, Heart, Link2, Palette, Pencil, RotateCw, Send } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { deviceLimitLabel, durationLabel, formatRub, pluralDays, type PlanDTO } from '@vpn/shared';
import { PageHeader } from '../components/Layout';
import { api, get, post, errorText } from '../lib/api';
import { useConfig, usePlans } from '../lib/queries';
import { PurchaseSheet } from '../components/Purchase';
import { confirmDialog, haptic, openExternal } from '../lib/tg';
import { forgetGift, giftShareUrl, readPendingGift, rememberGift, validGiftCode } from '../lib/gift-links';

type Theme = 'orbit' | 'aurora' | 'pearl';
type Greeting = { recipientName: string; senderName: string; message: string; theme: Theme };
export type GiftDTO = Greeting & { id: string; code: string | null; planName: string; days: number; trafficLimitGb: number; deviceLimit: number; state: 'ready' | 'redeemed' | 'revoked'; createdAt: string; redeemedAt: string | null; version: number };
type ReceivedGift = { id: string; planName: string; days: number; redeemedAt: string; senderName: string; message: string; theme: Theme; keepsCurrentPlan: boolean };
type GiftPreview = Greeting & { id: string; planName: string; days: number; trafficLimitGb: number; deviceLimit: number; activeSubscription: boolean; currentPlanName: string | null; currentExpiresAt: string | null; resultExpiresAt: string | null; alreadyRedeemed?: boolean; keepsCurrentPlan: boolean };
type Redemption = { ok: boolean; planName: string; expiresAt: string | null; keepsCurrentPlan: boolean };
type Tab = 'give' | 'receive' | 'history';
const LABEL = { ready: 'Готов к отправке', redeemed: 'Активирован', revoked: 'Отозван' };
const THEMES: { id: Theme; name: string; description: string }[] = [{ id: 'orbit', name: 'Orbit', description: 'Фиолетовая орбита' }, { id: 'aurora', name: 'Aurora', description: 'Северное сияние' }, { id: 'pearl', name: 'Pearl', description: 'Светлый минимализм' }];
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'смотрите в профиле';
const blankGreeting = (g: Partial<Greeting>): Greeting => ({ recipientName: g.recipientName ?? '', senderName: g.senderName ?? '', message: g.message ?? '', theme: g.theme ?? 'orbit' });

export function GiftCard({ gift, brand }: { gift: Partial<Greeting> & { planName: string; days: number }; brand: string }) {
  return <section className={`gift-postcard gift-postcard-${gift.theme ?? 'orbit'}`} aria-label="Подарочная открытка">
    <div className="gift-postcard-art" aria-hidden="true"><span /><span /><span /></div>
    <div className="gift-postcard-top"><span>{brand}</span><Gift className="h-5 w-5" /></div>
    <div className="gift-postcard-body">
      <p className="gift-postcard-to">{gift.recipientName ? `Кому: ${gift.recipientName}` : 'Для близкого человека'}</p>
      <h2>Свобода<br />быть на связи.</h2>
      <p className="gift-postcard-message">{gift.message || 'Больше любимых моментов. Больше хороших разговоров. Этот подарок — для тебя.'}</p>
      {gift.senderName && <p className="gift-postcard-from">С теплом, {gift.senderName}</p>}
    </div>
    <div className="gift-postcard-bottom"><span>{gift.planName}</span><b>{gift.days} {pluralDays(gift.days)}</b></div>
  </section>;
}

export default function Gifts() {
  const plans = usePlans(); const cfg = useConfig(); const qc = useQueryClient(); const toast = useToast();
  const [search] = useSearchParams(); const location = useLocation(); const pending = readPendingGift();
  const [tab, setTab] = useState<Tab>(pending || search.get('receive') === '1' ? 'receive' : 'give');
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [code, setCode] = useState(pending);
  const [previewCode, setPreviewCode] = useState(pending);
  const [success, setSuccess] = useState<Redemption | null>(null);
  const [filter, setFilter] = useState<'all' | GiftDTO['state']>('all');
  const [historyMode, setHistoryMode] = useState<'sent' | 'received'>('sent');
  const [editing, setEditing] = useState<GiftDTO | null>(null);
  const [draft, setDraft] = useState<Greeting>(blankGreeting({}));
  const [rotating, setRotating] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const brand = cfg.data?.brandName ?? 'VAYLO';
  const gifts = useQuery({ queryKey: ['gifts'], queryFn: () => get<GiftDTO[]>('/gifts') });
  const received = useQuery({ queryKey: ['gifts-received'], queryFn: () => get<ReceivedGift[]>('/gifts/received'), enabled: tab === 'history' && historyMode === 'received' });
  const preview = useQuery({ queryKey: ['gift-preview', previewCode], queryFn: () => post<GiftPreview>('/gifts/preview', { code: previewCode }), enabled: tab === 'receive' && validGiftCode(previewCode) && !success, retry: false, staleTime: 0 });

  useEffect(() => {
    const incoming = readPendingGift();
    if (incoming) { setCode(incoming); setPreviewCode(incoming); setTab('receive'); setSuccess(null); }
  }, [location.search, location.hash]);

  function updateGift(g: GiftDTO) {
    qc.setQueryData<GiftDTO[]>(['gifts'], old => old?.map(item => item.id === g.id ? g : item));
    void qc.invalidateQueries({ queryKey: ['gifts'] });
  }
  function share(g: GiftDTO) {
    if (!g.code) return;
    const link = giftShareUrl(g.code);
    const text = `${g.recipientName ? `${g.recipientName}, для тебя` : 'Для тебя'} — подарок ${brand}${g.senderName ? ` от ${g.senderName}` : ''}. Открой открытку и получи ${g.days} ${pluralDays(g.days)} доступа.`;
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  }
  function editGift(g: GiftDTO) { setEditing(g); setDraft(blankGreeting(g)); setSaveError(''); }
  const save = useMutation({
    mutationFn: () => api<GiftDTO>('PATCH', `/gifts/${editing!.id}`, { ...draft, expectedVersion: editing!.version }),
    onSuccess: g => { updateGift(g); setEditing(g); setDraft(blankGreeting(g)); setSaveError(''); haptic('success'); toast('Открытка сохранена', 'success'); },
    onError: e => { setSaveError(errorText(e)); void gifts.refetch(); },
  });
  async function saveAndShare() {
    try { const g = await save.mutateAsync(); share(g); } catch { /* The editor displays the error. */ }
  }
  async function rotate(g: GiftDTO) {
    if (!await confirmDialog('Заменить ссылку и код подарка? Старая ссылка и код перестанут работать. Сам подарок и поздравление сохранятся.')) return;
    setRotating(g.id);
    try { const fresh = await post<GiftDTO>(`/gifts/${g.id}/rotate`, { expectedVersion: g.version }); updateGift(fresh); toast('Новая ссылка готова. Отправьте её получателю.', 'success'); haptic('success'); }
    catch (e) { toast(errorText(e), 'error'); void gifts.refetch(); }
    finally { setRotating(null); }
  }
  const redeem = useMutation({
    mutationFn: () => post<Redemption>('/gifts/redeem', { code: previewCode }),
    onSuccess: r => {
      haptic('success'); setSuccess(r); setCode(''); setPreviewCode(''); forgetGift();
      for (const key of ['gifts', 'gifts-received', 'me', 'subscription']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: e => { toast(errorText(e), 'error'); void preview.refetch(); },
  });
  function viewGift() {
    const normalized = code.trim().toUpperCase();
    if (!validGiftCode(normalized)) { toast('Проверьте код: он начинается с VAYLO-', 'error'); return; }
    rememberGift(normalized); setSuccess(null); redeem.reset();
    if (previewCode === normalized) void preview.refetch();
    else setPreviewCode(normalized);
  }
  const ready = gifts.data?.filter(g => g.state === 'ready') ?? [];
  const shown = gifts.data?.filter(g => filter === 'all' || g.state === filter) ?? [];
  const isDirty = editing && JSON.stringify(draft) !== JSON.stringify(blankGreeting(editing));

  function giftHistoryCard(g: GiftDTO) {
    return <Card key={g.id} className="gift-history-card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3"><div><b className="text-base">{g.planName}</b><p className="mt-1 text-xs text-muted">{g.days} {pluralDays(g.days)} · куплен {date(g.createdAt)}</p></div><span className={`gift-status gift-status-${g.state}`}>{LABEL[g.state]}</span></div>
      {(g.recipientName || g.senderName) && <p className="text-sm text-muted">{g.recipientName ? `Кому: ${g.recipientName}` : 'С поздравлением'}{g.senderName ? ` · от ${g.senderName}` : ''}</p>}
      {g.state === 'redeemed' && g.redeemedAt && <p className="flex items-center gap-2 text-xs text-muted"><Check className="h-4 w-4 text-success" />Получен {date(g.redeemedAt)}</p>}
      {g.code && <>
        <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => editGift(g)}>Открытка</Button><Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => share(g)}>Отправить</Button></div>
        <details className="gift-code-details"><summary>Ссылка, код и управление</summary><div className="mt-4 space-y-3"><CopyField value={giftShareUrl(g.code)} /><CopyField value={g.code} /><Button variant="ghost" size="sm" icon={<RotateCw className="h-4 w-4" />} loading={rotating === g.id} disabled={!!rotating} onClick={() => void rotate(g)}>Заменить ссылку и код</Button><p className="text-xs leading-relaxed text-muted">Подарок получит тот, кто первым активирует код. Имя в открытке не ограничивает доступ к нему.</p></div></details>
      </>}
      {g.state === 'revoked' && <p className="text-xs leading-relaxed text-muted">Этот подарочный код больше не действует.</p>}
    </Card>;
  }

  return <div className="mx-auto max-w-2xl space-y-6">
    <PageHeader title="Подарки с теплом" subtitle="Подписка, открытка и немного свободы для близких" />
    <Tabs<Tab> value={tab} onChange={setTab} items={[{ value: 'give', label: 'Подарить' }, { value: 'receive', label: 'Получить' }, { value: 'history', label: 'Мои подарки' }]} />

    {tab === 'give' && <>
      <section className="gift-welcome"><div className="gift-welcome-icon"><Gift className="h-9 w-9" /></div><p className="orbit-kicker mb-3">Подарок, который сближает</p><h2 className="text-3xl font-extrabold tracking-tight">Не просто доступ.<br />Ваше внимание.</h2><p className="mt-4 text-sm leading-relaxed text-muted">Выберите подписку. После оплаты добавьте имена и поздравление, выберите оформление и отправьте открытку.</p><div className="gift-steps"><span>01 · Подписка</span><ArrowRight className="h-3 w-3" /><span>02 · Открытка</span><ArrowRight className="h-3 w-3" /><span>03 · Отправить</span></div></section>
      {ready.length > 0 && <div className="orbit-help"><div className="flex items-center gap-3"><Heart className="h-6 w-6 shrink-0 text-primary" /><div><b>У вас есть готовый подарок</b><p className="mt-1 text-xs text-muted">Добавьте пару тёплых слов и отправьте близкому человеку.</p></div></div><Button className="mt-4" full variant="secondary" onClick={() => editGift(ready[0]!)}>Оформить открытку</Button></div>}
      <section><div className="orbit-section-title">Выберите срок доступа</div>{plans.isError ? <ErrorState message={errorText(plans.error)} onRetry={() => void plans.refetch()} /> : plans.isLoading ? <Skeleton className="h-36 w-full" /> : !plans.data?.length ? <Card className="p-5 text-sm text-muted">Тарифы пока не настроены.</Card> : <div className="grid gap-3 sm:grid-cols-2">{plans.data.map(p => <button key={p.id} className="gift-plan card p-5 text-left" onClick={() => setPlan(p)}><div className="flex justify-between gap-3"><span className="text-lg font-bold">{p.name}</span><ArrowUpRight className="h-5 w-5 text-primary" /></div><p className="mt-2 text-xs text-muted">{durationLabel(p.durationDays)} · {deviceLimitLabel(p.deviceLimit)} устройств</p><div className="mt-5 text-2xl font-extrabold">{formatRub(p.price)}</div><p className="mt-1 text-xs text-muted">Окончательная стоимость — при оформлении</p></button>)}</div>}</section>
      <p className="gift-footnote">Новая подписка начнётся при получении подарка. Если у получателя уже есть платный доступ, подарок добавит дни с сохранением его условий.</p>
    </>}

    {tab === 'receive' && <>
      {success ? <section className="gift-success text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-success" /><p className="orbit-kicker mt-5">Подарок получен</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight">Больше хороших<br />моментов впереди.</h2><p className="mt-4 text-sm text-muted">{success.keepsCurrentPlan ? 'Ваша подписка продлена' : 'Доступ активирован'} до {date(success.expiresAt)}.</p><Link className="orbit-cta mt-6" to="/connect">Подключить устройство<ArrowUpRight className="h-5 w-5" /></Link><button className="mt-5 text-sm text-muted" onClick={() => { setSuccess(null); redeem.reset(); }}>Ввести другой код</button></section> : <>
        <Card className="space-y-4 p-5"><div className="flex items-center gap-3"><Gift className="h-6 w-6 text-primary" /><h2 className="text-lg font-bold">Вам подарили подписку?</h2></div><p className="text-sm text-muted">Откройте открытку по ссылке или введите код. Активация — только после вашего подтверждения.</p><label className="block"><span className="sr-only">Код подарка</span><Input value={code} maxLength={40} placeholder="VAYLO-…" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={e => { setCode(e.target.value.toUpperCase()); setPreviewCode(''); redeem.reset(); }} onKeyDown={e => { if (e.key === 'Enter') viewGift(); }} /></label><Button full variant="secondary" disabled={!code.trim()} loading={preview.isFetching} onClick={viewGift}>Открыть открытку</Button></Card>
        {preview.isLoading && previewCode && <Skeleton className="h-80 w-full" />}
        {preview.isError && <ErrorState message={errorText(preview.error)} onRetry={() => void preview.refetch()} />}
        {preview.data && !preview.isError && <>
          <GiftCard gift={preview.data} brand={brand} />
          <Card className="space-y-4 p-5"><h3 className="text-lg font-bold">{preview.data.alreadyRedeemed ? 'Подарок уже получен' : 'Что вы получите'}</h3><div className="gift-activation-detail"><span>{preview.data.alreadyRedeemed ? 'Получено' : 'Добавим'}</span><b>{preview.data.days} {pluralDays(preview.data.days)} доступа</b></div><div className="gift-activation-detail"><span>Доступ до</span><b>{date(preview.data.resultExpiresAt)}</b></div>
            {preview.data.keepsCurrentPlan ? <p className="gift-safe-note">Дни добавятся к вашей подписке{preview.data.currentPlanName ? ` «${preview.data.currentPlanName}»` : ''}. Её лимиты устройств и трафика сохранятся.</p> : <><div className="gift-activation-detail"><span>Устройства</span><b>{deviceLimitLabel(preview.data.deviceLimit)}</b></div><div className="gift-activation-detail"><span>Трафик</span><b>{preview.data.trafficLimitGb ? `${preview.data.trafficLimitGb} ГБ` : 'Безлимитный'}</b></div><p className="text-xs leading-relaxed text-muted">Применятся условия подарочной подписки. Дата выше рассчитана на текущий момент.</p></>}
            {redeem.isError && <p role="alert" className="text-sm text-danger">{errorText(redeem.error)}</p>}
            <Button full size="lg" loading={redeem.isPending} disabled={!previewCode || preview.isFetching} onClick={() => redeem.mutate()}>{preview.data.alreadyRedeemed ? 'Показать результат активации' : 'Подтвердить и получить подарок'}</Button><p className="text-center text-xs text-muted">На вашем аккаунте · без дополнительной оплаты</p>
          </Card>
        </>}
      </>}
    </>}

    {tab === 'history' && <>
      <div className="orbit-segment" aria-label="История подарков"><button aria-pressed={historyMode === 'sent'} onClick={() => setHistoryMode('sent')}>Мои покупки</button><button aria-pressed={historyMode === 'received'} onClick={() => setHistoryMode('received')}>Полученные</button></div>
      {historyMode === 'sent' ? <>
        <div className="gift-filter" aria-label="Статус подарка">{(['all', 'ready', 'redeemed', 'revoked'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'Все' : f === 'ready' ? 'Готовые' : LABEL[f]}</button>)}</div>
        {gifts.isError ? <ErrorState message={errorText(gifts.error)} onRetry={() => void gifts.refetch()} /> : gifts.isLoading ? <Skeleton className="h-40 w-full" /> : !shown.length ? <Card className="gift-empty"><Gift className="mx-auto mb-3 h-8 w-8 text-primary" /><b>{filter === 'all' ? 'Здесь будут ваши подарки' : 'Таких подарков пока нет'}</b><p className="mt-2 text-sm text-muted">{filter === 'all' ? 'Купите подписку, оформите открытку и отправьте её близкому человеку.' : 'Выберите другой статус, чтобы посмотреть остальные подарки.'}</p>{filter === 'all' && <Button className="mt-4" variant="secondary" onClick={() => setTab('give')}>Выбрать подарок</Button>}</Card> : shown.map(giftHistoryCard)}
      </> : received.isError ? <ErrorState message={errorText(received.error)} onRetry={() => void received.refetch()} /> : received.isLoading ? <Skeleton className="h-40 w-full" /> : !received.data?.length ? <Card className="gift-empty"><Heart className="mx-auto mb-3 h-8 w-8 text-primary" /><b>Ваши подарки — впереди</b><p className="mt-2 text-sm text-muted">Активированные вами подарки появятся здесь.</p></Card> : received.data.map(g => <Card className="mb-3 space-y-3 p-5" key={g.id}><div className="flex items-start justify-between gap-3"><div><b>{g.planName}</b><p className="mt-1 text-xs text-muted">Получен {date(g.redeemedAt)} · +{g.days} {pluralDays(g.days)}</p></div><CheckCircle2 className="h-5 w-5 shrink-0 text-success" /></div>{g.senderName && <p className="text-sm text-primary">От {g.senderName}</p>}{g.message && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{g.message}</p>}</Card>)}
    </>}

    <PurchaseSheet item={plan ? { kind: 'plan', plan, gift: true } : null} onClose={() => { setPlan(null); void gifts.refetch(); }} />
    <Sheet open={!!editing} onClose={() => { if (!save.isPending) setEditing(null); }} title="Оформить открытку" wide>
      {editing && <div className="space-y-5">
        <GiftCard gift={{ ...draft, planName: editing.planName, days: editing.days }} brand={brand} />
        <div><div className="mb-3 flex items-center gap-2 text-sm font-bold"><Palette className="h-4 w-4 text-primary" />Оформление</div><div className="gift-themes">{THEMES.map(t => <button key={t.id} aria-pressed={draft.theme === t.id} aria-label={t.description} onClick={() => setDraft(d => ({ ...d, theme: t.id }))}><span className={`gift-theme-dot gift-theme-dot-${t.id}`} /><span>{t.name}</span>{draft.theme === t.id && <Check className="ml-auto h-4 w-4" />}</button>)}</div></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm"><span className="mb-2 block font-semibold">Кому</span><Input value={draft.recipientName} maxLength={60} placeholder="Например, Саше" onChange={e => setDraft(d => ({ ...d, recipientName: e.target.value }))} /></label><label className="text-sm"><span className="mb-2 block font-semibold">От кого</span><Input value={draft.senderName} maxLength={60} placeholder="Ваше имя" onChange={e => setDraft(d => ({ ...d, senderName: e.target.value }))} /></label></div>
        <label className="block text-sm"><span className="mb-2 block font-semibold">Пару тёплых слов</span><Textarea rows={4} value={draft.message} maxLength={400} placeholder="Напишите поздравление…" onChange={e => setDraft(d => ({ ...d, message: e.target.value }))} /><span className="mt-1 block text-right text-xs text-muted">{draft.message.length} / 400</span></label>
        <p className="text-xs leading-relaxed text-muted">Имена и поздравление видит получатель открытки. Имя не привязывает подарок к конкретному аккаунту: код сработает один раз.</p>
        {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
        <Button full size="lg" loading={save.isPending} icon={<Send className="h-4 w-4" />} onClick={() => void saveAndShare()}>Сохранить и отправить</Button>
        <Button full variant="secondary" disabled={!isDirty || save.isPending} onClick={() => save.mutate()}>Сохранить открытку</Button>
      </div>}
    </Sheet>
  </div>;
}

import { Badge, Button, Card, Field, Input, Select, Switch, Tabs, Textarea, cn, useToast, ErrorState, EmptyState, Sheet, ChatFrame, ChatMessages, ChatComposer, useChatScroll, SupportPhotos, type SupportDraftPhoto } from '@vpn/ui';
import { SUPPORT_PRIORITY, SUPPORT_STATUSES, SUPPORT_STATUS_LABEL, type SupportStatus, type AdminRole, type SupportPriority, type SupportAttachmentDTO } from '@vpn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, ArrowLeft, Bot, CheckCircle2, Headset, Plug, Plus, Send, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { GroupForm, Toggle } from './settings';
import { DeskContext, useDesk, useApi, useAuth, errMsg, type SupportTransport } from './context';


import { Link, useSearchParams } from 'react-router-dom';


interface Row { archivedAt: string | null; id: string; number: number; kind: 'chat' | 'ticket'; subject: string; priority: SupportPriority; status: SupportStatus; mode: 'ai' | 'human'; aiOff: boolean; escalated: boolean; unread: boolean; updatedAt: string; user: { id: string; username: string | null; name: string | null; tgId: number | null }; last: string; dislikes: number }
interface Msg { id: string; author: 'user' | 'ai' | 'admin' | 'system'; body: string; rating: number | null; createdAt: string; flagged?: boolean; attachments?: SupportAttachmentDTO[] }
interface Thread { ticket: Row & { aiOff: boolean; sub: { plan: string | null; trial: boolean; expiresAt: string } | null }; messages: Msg[] }
interface Stats { open: number; urgent: number; important: number; unread: number; ai_active: number; aiAnswers7d: number; likes7d: number; dislikes7d: number; aiToday: number; in_progress:number; waiting_user:number; empty_chats:number; archived:number; aiEnabled:boolean }
interface Tpl { id: string; title: string; body: string }

const TONE = { normal: 'success', important: 'warning', urgent: 'danger' } as const;
const STATUS = SUPPORT_STATUS_LABEL;
const who = (u: Row['user']) => (u.username ? '@' + u.username : u.name ?? String(u.tgId ?? u.id.slice(0, 6)));
const when = (iso: string) => { const d = new Date(iso); return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

interface Preset { id: string; label: string; free: boolean; url: string; models: { id: string; label: string }[]; cap?: number; steps: string; limit: string; warn?: string; link: string }
/** Лимиты и названия моделей — по данным открытых источников на октябрь 2026; провайдеры меняют их, поэтому кнопка «Проверить подключение» обязательна */
const PRESETS: Preset[] = [
  { id: 'groq', label: 'Groq — бесплатно (рекомендуем для старта)', free: true, url: 'https://api.groq.com/openai/v1', cap: 900, link: 'https://console.groq.com/keys',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — умная и быстрая (≈1000 вопросов/сутки)' }, { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B — самая умная (≈1000/сутки)' }, { id: 'qwen/qwen3-32b', label: 'Qwen3 32B — хороша по-русски (≈1000/сутки)' }, { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — очень быстрая, проще (≈14 000/сутки)' }],
    steps: 'Откройте console.groq.com → войдите (Google/GitHub) → API Keys → Create API Key → скопируйте ключ. Карта не нужна.', limit: 'Бесплатный лимит примерно 1000 запросов в сутки на одну модель (у «8B» — 14 400) на весь сервис.', warn: 'Из России регистрация может потребовать VPN. Сами запросы идут с вашего сервера, ему VPN не нужен.' },
  { id: 'openrouter-free', label: 'OpenRouter — бесплатные модели', free: true, url: 'https://openrouter.ai/api/v1', cap: 45, link: 'https://openrouter.ai/keys',
    models: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' }, { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B (free)' }, { id: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B (free)' }, { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B (free)' }],
    steps: 'Откройте openrouter.ai → войдите → Keys → Create Key → скопируйте. Карта не нужна.', limit: 'Бесплатно — всего 50 запросов в сутки на всех. Разовое пополнение $10 поднимает лимит до ≈1000 в сутки (бесплатные модели остаются бесплатными).', warn: 'Годится как запасной вариант, а не основной.' },
  { id: 'gemini', label: 'Google Gemini — бесплатно (малый лимит)', free: true, url: 'https://generativelanguage.googleapis.com/v1beta/openai', cap: 450, link: 'https://aistudio.google.com/apikey',
    models: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (≈500/сутки, неофициально)' }, { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (≈20/сутки — мало)' }],
    steps: 'Откройте aistudio.google.com/apikey → войдите в Google-аккаунт → Create API key.', limit: 'Google официально лимиты бесплатного тарифа не публикует: по отзывам ≈500 запросов в сутки для Flash-Lite и ≈20 для Flash.', warn: 'Россия не входит в список поддерживаемых стран: ключ придётся создать через VPN. Бесплатные запросы Google может использовать для обучения.' },
  { id: 'anymodel', label: 'AnyModel — платно, одним ключом Claude, GPT, Gemini и др.', free: false, url: 'https://anymodel.org/v1', link: 'https://anymodel.org',
    models: [],
    steps: 'anymodel.org → войдите → пополните баланс («Купить токены») → создайте API-ключ и вставьте его ниже. Затем нажмите «Загрузить модели по ключу» и выберите модель из списка.', limit: 'Оплата по токенам с общего баланса; цена зависит от модели (дешёвые модели подходят для поддержки).' },
  { id: 'deepseek', label: 'DeepSeek — платно, очень дёшево', free: false, url: 'https://api.deepseek.com/v1', link: 'https://platform.deepseek.com/api_keys',
    models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat (V3) — копейки за диалог' }],
    steps: 'platform.deepseek.com → пополните баланс на пару долларов → API keys → создайте ключ.', limit: 'Оплата по токенам, обычно доли копейки за ответ.' },
  { id: 'openrouter', label: 'OpenRouter — платные модели (в т.ч. Claude, GPT)', free: false, url: 'https://openrouter.ai/api/v1', link: 'https://openrouter.ai/keys',
    models: [{ id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat — дёшево' }, { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' }],
    steps: 'openrouter.ai → пополните баланс → Keys. Любую модель (например, Claude) выберите в каталоге на сайте и впишите её ID в поле «Своя модель».', limit: 'Оплата по токенам, цена у каждой модели своя.' },
  { id: 'openai', label: 'OpenAI — платно', free: false, url: 'https://api.openai.com/v1', link: 'https://platform.openai.com/api-keys',
    models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini — недорого' }],
    steps: 'platform.openai.com → пополните баланс → API keys → Create new secret key.', limit: 'Оплата по токенам.' },
];

export function SupportDesk({api,role,embedded=false}:{api:SupportTransport;role:AdminRole;embedded?:boolean}) {
  return <DeskContext.Provider value={{api,role,embedded}}><SupportPage /></DeskContext.Provider>;
}
export type {SupportTransport} from './context';
function PageTitle({title,subtitle,actions}:{title:string;subtitle?:string;actions?:ReactNode}) {
 const {embedded}=useDesk();return <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">{embedded&&<Link to="/admin" className="mb-2 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-primary"><ArrowLeft className="h-4 w-4"/>Админ-панель</Link>}<h1 className="page-title text-[28px] font-extrabold tracking-tight">{title}</h1>{subtitle&&<p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{actions}</header>;
}
function SupportPage() {
  const {get,post}=useApi();
  const {embedded}=useDesk();
  const { can } = useAuth();
  const [tab, setTab] = useState<'queue' | 'ai' | 'templates' | 'settings'>('queue');
  const [focus, setFocus] = useState(false); // открыт диалог: на телефоне прячем всё лишнее, чтобы переписка занимала экран
  const qc = useQueryClient();
  const toast = useToast();
  const stats = useQuery({ enabled:can('support'), queryKey: ['admin-support-stats'], queryFn: () => get<Stats>('/support/stats'), refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: Record<string, any> }>('/settings'), enabled: can('admin') });
  const aiOn = stats.data?.aiEnabled ?? Boolean(settings.data?.settings.support?.ai_enabled);
  const toggleAi = useMutation({
    mutationFn: (enabled: boolean) => post('/support/ai', { enabled }),
    onSuccess: (_r, enabled) => { void qc.invalidateQueries({queryKey:['admin-support-stats']}); void qc.invalidateQueries({ queryKey: ['settings'] }); toast(enabled ? 'ИИ-помощник включён' : 'ИИ выключен — все обращения идут вам', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const s = stats.data;
  const cards: [string, string | number, string][] = [
    ['В очереди', s?.open ?? '—', ''],
    ['🔴 Срочные', s?.urgent ?? '—', s?.urgent ? 'text-danger' : ''],
    ['В работе', s?.in_progress ?? '—', ''],
    ['Непрочитанные', s?.unread ?? '—', s?.unread ? 'text-warning' : ''],
    ['Ответов ИИ за 7 дней', s?.aiAnswers7d ?? '—', ''],
    ['Нужно уточнение', s?.waiting_user ?? '—', ''],
  ];
  const items = [{ value: 'queue' as const, label: 'Очередь' }, { value: 'ai' as const, label: 'Диалоги с ИИ' }, { value: 'templates' as const, label: 'Шаблоны' }, ...(can('admin') ? [{ value: 'settings' as const, label: 'Настройки ИИ' }] : [])];
  if(!can('support')) return <Card><EmptyState title="Нет доступа к поддержке" text="Для переписки нужна роль поддержки, администратора или владельца." /></Card>;
  return (
    <div className="support-desk min-w-0 space-y-3 sm:space-y-5" data-embedded={embedded} data-focused={focus}>
      <div className="desk-overview"><PageTitle title="Поддержка" subtitle="Обращения клиентов и ИИ-помощник" actions={can('admin') ? (
        <label className="flex items-center gap-3 rounded-2xl border border-fg/10 bg-fg/[.04] px-4 py-2.5 text-sm">
          <Sparkles className={cn('h-4 w-4', aiOn ? 'text-primary' : 'text-muted')} />
          <span className="font-semibold">ИИ-помощник</span>
          <Switch checked={aiOn} onChange={(v) => toggleAi.mutate(v)} label="ИИ-помощник" />
        </label>
      ) : undefined} /></div>
      <div className="desk-summary grid gap-2">
        {cards.map(([l, v, c]) => <div key={l} className="card p-3 sm:p-3.5"><div className="text-xs text-muted">{l}</div><div className={cn('num mt-0.5 text-xl font-extrabold sm:mt-1 sm:text-2xl', c)}>{v}</div></div>)}
      </div>
      {stats.isError&&<div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm">Не удалось обновить сводку. <button type="button" onClick={()=>void stats.refetch()} className="font-bold underline">Повторить</button></div>}
      <div className="desk-tabs"><Tabs value={tab} onChange={(v) => { setFocus(false); setTab(v); }} items={items} /></div>
      {tab === 'queue' && <Queue key="q" mode="human" onFocus={setFocus} />}
      {tab === 'ai' && <Queue key="a" mode="ai" onFocus={setFocus} />}
      {tab === 'templates' && <Templates />}
      {tab === 'settings' && can('admin') && (settings.isError ? <ErrorState message={errMsg(settings.error)} onRetry={()=>void settings.refetch()}/> : settings.data ? <AiSettings data={settings.data.settings.support} locked={!can('owner')}/> : <Card className="p-6 text-muted">Загрузка настроек…</Card>)}
    </div>
  );
}

function Queue({ mode, onFocus }: { mode: 'human' | 'ai'; onFocus?: (f: boolean) => void }) {
  const {get,post,patch,put,del,loadSupportPhoto}=useApi();
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [content,setContent]=useState('messages');
  const [archive,setArchive]=useState('active');
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const requested = params.get('ticket');
  const [sel, setSel] = useState<string | null>(requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null);
  useEffect(() => { setSel(requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : null); }, [requested]);
  useEffect(() => { onFocus?.(sel !== null); return () => onFocus?.(false); }, [sel]);
  const qs = new URLSearchParams({ mode, content, archive, ...(status ? { status } : mode === 'human' ? {} : {}), ...(priority ? { priority } : {}), ...(search.trim() ? { search: search.trim() } : {}) }).toString();
  const list = useQuery({ queryKey: ['admin-support-list', qs], queryFn: () => get<Row[]>(`/support/tickets?${qs}`), refetchInterval: 12_000 });
  return (
    <div className="desk-layout grid gap-4" data-selected={!!sel}>
      <div className="desk-queue min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Фильтр статуса" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{SUPPORT_STATUSES.map(k=><option key={k} value={k}>{STATUS[k]}</option>)}</Select>
          {mode === 'human' ? <Select aria-label="Фильтр срочности" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Срочность</option><option value="urgent">🔴 Срочные</option><option value="important">🟡 Важные</option><option value="normal">🟢 Обычные</option></Select> : <div />}
        </div>
        <div className="grid grid-cols-2 gap-2"><Select aria-label="Содержимое обращений" value={content} onChange={e=>setContent(e.target.value)}><option value="messages">С перепиской</option><option value="all">Все чаты</option><option value="empty">Пустые чаты</option></Select><Select aria-label="Архив очереди" value={archive} onChange={e=>setArchive(e.target.value)}><option value="active">В очереди</option><option value="archived">Убранные</option><option value="all">Везде</option></Select></div>
        {archive!=='active'&&<p className="text-xs leading-relaxed text-muted">Убранные чаты остаются у клиента. Его новое сообщение вернёт чат в очередь.</p>}
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск: @username, тема или №" />
        <div className="space-y-2">
          {list.isError&&<ErrorState message={errMsg(list.error)} onRetry={()=>void list.refetch()}/>}
          {list.isLoading && <div className="text-sm text-muted">Загрузка…</div>}
          {list.data?.length === 0 && <Card className="p-6 text-center text-sm text-muted">{archive==='archived'?'Убранных чатов пока нет':content==='empty'?'Пустых чатов нет':mode === 'human' ? 'Обращений нет — всё разобрано 🎉' : 'Диалогов с ИИ пока нет'}</Card>}
          {list.data?.map((r) => (
            <button key={r.id} onClick={() => {setSel(r.id);setParams(p=>{p.set('ticket',r.id);return p;},{replace:true});}} className={cn('card w-full min-w-0 p-3.5 text-left transition', sel === r.id && '!border-primary shadow-glow')}>
              <div className="flex items-start gap-2">
                {r.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />}
                <span className="min-w-0 flex-1 break-words font-semibold">{r.kind === 'chat' ? 'Чат' : r.subject || `№${r.number}`}</span>
                <Badge tone={TONE[r.priority]}>{SUPPORT_PRIORITY[r.priority].emoji} {SUPPORT_PRIORITY[r.priority].label}</Badge>
              </div>
              <div className="mt-1 truncate text-sm text-muted">{r.last || 'Черновик: пользователь ещё не отправил сообщение'}</div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted">
                <span className="truncate">{who(r.user)} · №{r.number}{r.escalated ? ' · от ИИ' : ''}{r.dislikes ? ` · 👎${r.dislikes}` : ''}</span>
                <span>{r.archivedAt?'Убрано · ':''}{STATUS[r.status]} · {when(r.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="desk-detail min-w-0">
        {sel ? <ThreadPane key={sel} id={sel} onBack={() => { setSel(null); setParams(p => { p.delete('ticket'); return p; }, { replace: true }); }} /> : <Card className="grid h-64 place-items-center p-6 text-center text-muted">Выберите обращение слева</Card>}
      </div>
    </div>
  );
}

function ThreadPane({ id, onBack }: { id: string; onBack: () => void }) {
  const {get,post,patch,loadSupportPhoto}=useApi();
  const qc=useQueryClient(),toast=useToast();
  const [text,setText]=useState(''),[photos,setPhotos]=useState<SupportDraftPhoto[]>([]),[preparing,setPreparing]=useState(false);
  const [details,setDetails]=useState(false),[confirmArchive,setConfirmArchive]=useState(false);
  const [edit,setEdit]=useState<{priority:SupportPriority;status:SupportStatus;reason:string}|null>(null);
  const th=useQuery({queryKey:['admin-support-thread',id],queryFn:()=>get<Thread>(`/support/tickets/${id}`),refetchInterval:6000});
  const tpls=useQuery({queryKey:['admin-support-tpl'],queryFn:()=>get<Tpl[]>('/support/templates')});
  const stats=useQuery({queryKey:['admin-support-stats'],queryFn:()=>get<Stats>('/support/stats'),staleTime:10_000});
  const scroll=useChatScroll(th.data?.messages.length??0);
  const refresh=()=>{void qc.invalidateQueries({queryKey:['admin-support-thread',id]});void qc.invalidateQueries({queryKey:['admin-support-list']});void qc.invalidateQueries({queryKey:['admin-support-stats']});};
  const reply=useMutation({mutationFn:(close:boolean)=>post<{notified?:boolean}>(`/support/tickets/${id}/reply`,{text,close,photos:photos.map(({image,name})=>({image,name}))}),onSuccess:r=>{setText('');setPhotos([]);setDetails(false);scroll.jump();refresh();toast(r.notified===false?'Ответ сохранён в диалоге. Бот не смог доставить уведомление.':'Ответ отправлен, клиент уведомлён','success');},onError:e=>toast(errMsg(e),'error')});
  const upd=useMutation({mutationFn:(body:Record<string,unknown>)=>patch<{changed?:boolean;notified?:boolean}>(`/support/tickets/${id}`,body),onSuccess:r=>{setEdit(null);refresh();toast(r.changed===false?'Изменений нет':r.notified===false?'Изменение сохранено в диалоге. Бот не смог доставить уведомление.':r.notified?'Изменение сохранено, клиент уведомлён':'Настройки диалога обновлены','success');},onError:e=>toast(errMsg(e),'error')});
  const archive=useMutation({mutationFn:(restore:boolean)=>post(`/support/tickets/${id}/${restore?'restore':'archive'}`,{}),onSuccess:(_r,restore)=>{setConfirmArchive(false);setDetails(false);refresh();toast(restore?'Чат возвращён в очередь':'Чат убран из очереди. История у клиента сохранена.','success');if(!restore)onBack();},onError:e=>toast(errMsg(e),'error')});
  if(th.isLoading)return <Card className="grid h-64 place-items-center text-muted">Загрузка диалога…</Card>;
  if(th.isError&&!th.data)return <Card className="p-4"><Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="h-4 w-4"/>}>К списку</Button><ErrorState message={errMsg(th.error)} onRetry={()=>void th.refetch()}/></Card>;
  if(!th.data)return null;
  const {ticket:t,messages}=th.data;
  const busy=reply.isPending||upd.isPending||archive.isPending;
  const subject=t.subject||`Обращение №${t.number}`;
  return <>
    <ChatFrame label="Переписка поддержки — администратор">
      <header className="vpn-chat-header"><button type="button" className="vpn-chat-icon" aria-label="К списку обращений" onClick={onBack}><ArrowLeft size={21}/></button><button type="button" className="vpn-chat-title" aria-label="Информация об обращении" onClick={()=>setDetails(true)}><strong>{subject}</strong><small>{who(t.user)} · №{t.number} · {t.archivedAt?'В архиве':STATUS[t.status]}</small></button><button type="button" className="vpn-chat-icon" aria-label="Параметры обращения" title="Параметры обращения" onClick={()=>setDetails(true)}><MoreHorizontal size={22}/></button></header>
      {th.isError&&<div role="alert" className="vpn-chat-notice">Не удалось обновить переписку. <button className="underline" onClick={()=>void th.refetch()}>Повторить</button></div>}
      <ChatMessages scroll={scroll}>
        {!messages.some(m=>m.author!=='system')&&<div className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">Пользователь ещё не отправил сообщение. Это пустой черновик.</div>}
        {messages.map(m=>m.author==='system'?<div key={m.id} className="desk-system-message mx-auto max-w-[95%] whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-center text-xs leading-relaxed text-muted">{m.body}</div>:<div key={m.id} className={cn('flex gap-2',m.author==='admin'&&'flex-row-reverse')}>
          <span className={cn('mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full',m.author==='admin'?'bg-success/15 text-success':m.author==='ai'?'bg-primary/15 text-primary':'bg-surface-2 text-muted')}>{m.author==='admin'?<Headset className="h-3.5 w-3.5"/>:m.author==='ai'?<Bot className="h-3.5 w-3.5"/>:'К'}</span>
          <div className={cn('flex min-w-0 max-w-[88%] flex-col',m.author==='admin'&&'items-end',m.attachments?.length&&'w-80')}><div className="mb-1 text-[10px] text-muted">{m.author==='admin'?'Поддержка':m.author==='ai'?'ИИ':'Клиент'} · {when(m.createdAt)}{m.flagged?' · скрыто фильтром':''}</div><div style={m.author==='admin'?{background:'var(--button-gradient,linear-gradient(115deg,#7142c8,#5429ad))',color:'#fff'}:undefined} className={cn('whitespace-pre-wrap break-words rounded-2xl border border-border/70 bg-surface-2 px-3 py-2.5 text-sm leading-relaxed',m.attachments?.length&&'w-full',m.flagged&&'!border-danger/50')}>{m.body&&<p>{m.body}</p>}<SupportPhotos photos={m.attachments} load={loadSupportPhoto} className={m.body?'mt-2':''}/></div></div>
        </div>)}
      </ChatMessages>
      {t.archivedAt?<div className="vpn-chat-notice flex items-center justify-between gap-3"><span>Чат убран из очереди</span><Button disabled={busy} onClick={()=>archive.mutate(true)}>Вернуть в очередь</Button></div>:<ChatComposer value={text} onChange={setText} onSend={()=>reply.mutate(false)} photos={photos} onPhotosChange={setPhotos} onPreparingChange={setPreparing} disabled={busy} sending={reply.isPending} maxLength={3000} placeholder="Ответ клиенту…" label="Ответ клиенту"/>}
    </ChatFrame>
    <Sheet open={details} onClose={()=>{if(!busy)setDetails(false);}} title="Параметры обращения">
      <div className="space-y-4"><div className="break-words"><h3 className="font-bold">{subject}</h3><p className="mt-1 text-sm text-muted">{who(t.user)} · №{t.number}</p><p className="mt-2 text-xs leading-relaxed text-muted">{t.sub?`${t.sub.trial?'Пробная подписка':t.sub.plan??'Подписка'} · до ${new Date(t.sub.expiresAt).toLocaleDateString('ru-RU')}`:'Нет подписки'}</p></div>
        <div className="flex flex-wrap gap-2"><Badge tone={TONE[t.priority]}>{SUPPORT_PRIORITY[t.priority].emoji} {SUPPORT_PRIORITY[t.priority].label}</Badge><Badge>{STATUS[t.status]}</Badge></div>
        <Button full variant="secondary" disabled={busy} icon={<Pencil size={16}/>} onClick={()=>{setDetails(false);setEdit({priority:t.priority,status:t.status,reason:''});}}>Статус и срочность</Button>
        {t.kind==='chat'&&<Button full variant="secondary" disabled={busy||(t.mode!=='ai'&&!stats.data?.aiEnabled)} onClick={()=>upd.mutate(t.mode==='ai'?{mode:'human',aiOff:true}:{mode:'ai',aiOff:false})}>{t.mode==='ai'?'Передать оператору':stats.data?.aiEnabled?'Включить ИИ':'ИИ выключен'}</Button>}
        {tpls.data?.length?<div className="space-y-2"><h3 className="text-sm font-semibold">Шаблоны ответов</h3><div className="grid gap-2">{tpls.data.map(x=><Button key={x.id} variant="secondary" className="!h-auto min-h-11 !justify-start whitespace-normal !py-2 text-left" disabled={busy||preparing} onClick={()=>{setText(old=>((old?old+'\n':'')+x.body).slice(0,3000));setDetails(false);}}>{x.title}</Button>)}</div></div>:null}
        {!t.archivedAt&&<Button full disabled={busy||preparing||(!text.trim()&&!photos.length)} loading={reply.isPending} onClick={()=>reply.mutate(true)}>Отправить и закрыть</Button>}
        <Button full variant="secondary" disabled={busy} icon={t.archivedAt?<ArchiveRestore size={16}/>:<Archive size={16}/>} onClick={()=>{setDetails(false);if(t.archivedAt)archive.mutate(true);else setConfirmArchive(true);}}>{t.archivedAt?'Вернуть в очередь':'Убрать из админской очереди'}</Button>
        <p className="text-xs leading-relaxed text-muted">Архив скрывает чат у сотрудников. Сообщения и фотографии у клиента сохраняются.</p>
      </div>
    </Sheet>
    <Sheet open={confirmArchive} onClose={()=>{if(!archive.isPending)setConfirmArchive(false);}} title="Убрать чат из очереди?">
      <div className="space-y-4"><p className="text-sm leading-relaxed text-muted">Чат исчезнет из основной очереди сотрудников. У клиента останутся все сообщения и фотографии. Его новое сообщение автоматически вернёт обращение в очередь.</p><p className="text-sm text-muted">Вернуть чат вручную можно через фильтр «Убранные».</p><div className="grid grid-cols-2 gap-2"><Button variant="secondary" disabled={archive.isPending} onClick={()=>setConfirmArchive(false)}>Отмена</Button><Button loading={archive.isPending} onClick={()=>archive.mutate(false)}>Убрать</Button></div></div>
    </Sheet>
    <Sheet open={!!edit} onClose={()=>{if(!upd.isPending)setEdit(null);}} title="Статус и срочность">
      {edit&&<div className="space-y-4"><p className="text-sm leading-relaxed text-muted">Изменение появится в переписке. Клиент также получит уведомление в боте.</p><fieldset disabled={upd.isPending} className="space-y-4"><Field label="Приоритет"><Select aria-label="Приоритет" value={edit.priority} onChange={e=>setEdit({...edit,priority:e.target.value as SupportPriority})}>{(Object.keys(SUPPORT_PRIORITY) as SupportPriority[]).map(p=><option key={p} value={p}>{SUPPORT_PRIORITY[p].emoji} {SUPPORT_PRIORITY[p].label}</option>)}</Select></Field><Field label="Статус обращения"><Select aria-label="Статус обращения" value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value as SupportStatus})}>{SUPPORT_STATUSES.map(status=><option key={status} value={status}>{STATUS[status]}</option>)}</Select></Field><Field label="Причина изменения" hint="Необязательно. Этот текст увидит клиент."><Textarea aria-label="Причина изменения" value={edit.reason} maxLength={300} onChange={e=>setEdit({...edit,reason:e.target.value})} placeholder="Например: проблема затрагивает одну локацию, остальные доступны"/></Field><div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm leading-relaxed">Приоритет: {SUPPORT_PRIORITY[t.priority].label} → {SUPPORT_PRIORITY[edit.priority].label}<br/>Статус: {STATUS[t.status]} → {STATUS[edit.status]}</div><Button full type="button" loading={upd.isPending} disabled={edit.priority===t.priority&&edit.status===t.status} onClick={()=>upd.mutate(edit)}>Сохранить и уведомить</Button></fieldset></div>}
    </Sheet>
  </>;
}

function Templates() {
  const {get,post,patch,put,del,loadSupportPhoto}=useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin-support-tpl'], queryFn: () => get<Tpl[]>('/support/templates') });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-support-tpl'] });
  const add = useMutation({ mutationFn: () => post('/support/templates', { title, body }), onSuccess: () => { setTitle(''); setBody(''); void refresh(); toast('Шаблон добавлен', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const rm = useMutation({ mutationFn: (id: string) => del(`/support/templates/${id}`), onSuccess: () => void refresh(), onError: (e) => toast(errMsg(e), 'error') });
  if(list.isError)return <ErrorState message={errMsg(list.error)} onRetry={()=>void list.refetch()}/>;
  const seed: [string, string][] = [
    ['Обновить подписку', 'Здравствуйте! Откройте приложение-клиент, обновите подписку (кнопка обновления рядом со списком серверов) и выберите другую локацию 🙂'],
    ['Другая сеть', 'Попробуйте переключиться между Wi‑Fi и мобильным интернетом: часть провайдеров ограничивает отдельные серверы. Если по одной сети работает — выберите другую локацию.'],
    ['Время на телефоне', 'Проверьте дату и время на телефоне — включите «Автоматически / по сети». Из-за сбитого времени VPN не подключается.'],
    ['Уточнить детали', 'Подскажите, пожалуйста: какое устройство и приложение-клиент используете, и что именно происходит (ошибка, бесконечное подключение, нет интернета)?'],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <div className="font-semibold">Новый шаблон</div>
        <Field label="Название"><Input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Обновить подписку" /></Field>
        <Field label="Текст ответа"><Textarea value={body} maxLength={1500} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={!title.trim() || !body.trim()} onClick={() => add.mutate()}>Добавить</Button>
        </div>
        {list.data?.length === 0 && (
          <div className="rounded-xl border border-fg/10 bg-fg/[.03] p-3 text-sm">
            <div className="mb-2 text-muted">Шаблонов пока нет. Добавить готовые?</div>
            <Button size="sm" variant="secondary" onClick={async () => { for (const [t, b] of seed) await post('/support/templates', { title: t, body: b }); void refresh(); }}>Добавить 4 готовых шаблона</Button>
          </div>
        )}
      </Card>
      <div className="space-y-2">
        {list.data?.map((x) => (
          <Card key={x.id} className="flex items-start gap-3 p-3.5">
            <div className="min-w-0 flex-1"><div className="font-semibold">{x.title}</div><div className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{x.body}</div></div>
            <button aria-label="Удалить" onClick={() => rm.mutate(x.id)} className="rounded-lg p-2 text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Выбор провайдера и модели: бесплатные сверху, подсказка получения ключа, лимиты; prefix — '' (основной) или 'fallback_' (запасной) */
function ProviderBlock({ v, set, prefix, title, hint }: { v: any; set: (k: string, val: unknown) => void; prefix: '' | 'fallback_'; title: string; hint: string }) {
  const {get,post,patch,put,del,loadSupportPhoto}=useApi();
  const f = (k: 'base_url' | 'model' | 'key') => `ai_${prefix}${k}`;
  const url: string = v[f('base_url')] ?? '';
  const model: string = v[f('model')] ?? '';
  const preset = PRESETS.find((p) => p.url === url && (p.id !== 'openrouter-free' || /:free$/.test(model)) && (p.id !== 'openrouter' || !/:free$/.test(model)));
  const inList = preset?.models.some((m) => m.id === model);
  const toast = useToast();
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [q, setQ] = useState('');
  const loadModels = useMutation({
    mutationFn: () => post<{ models: { id: string }[] }>('/support/ai-models', { which: prefix === '' ? 'main' : 'fallback', base_url: url, key: v[f('key')] ?? '' }),
    onSuccess: (r) => { setFetched(r.models.map((m) => m.id)); setQ(''); toast(`Найдено моделей: ${r.models.length}`, 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const shown = (fetched ?? []).filter((id) => !q || id.toLowerCase().includes(q.toLowerCase()));
  const pick = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) { set(f('base_url'), ''); return; }
    set(f('base_url'), p.url); set(f('model'), p.models[0]?.id ?? '');
    // у бесплатных тарифов лимит в сутки жёсткий: ставим потолок чуть ниже, дальше диалоги сами идут операторам
    if (p.free && p.cap && prefix === '') set('ai_global_limit', p.cap);
  };
  return (
    <div className="space-y-3 rounded-2xl border border-fg/[.08] bg-fg/[.02] p-4">
      <div><div className="font-semibold">{title}</div><div className="text-xs text-muted">{hint}</div></div>
      <Field label="Провайдер">
        <Select value={preset?.id ?? (url ? 'custom' : '')} onChange={(e) => pick(e.target.value)}>
          <option value="">{prefix ? 'Не использовать' : 'Выберите…'}</option>
          <optgroup label="Бесплатные">{PRESETS.filter((p) => p.free).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
          <optgroup label="Платные">{PRESETS.filter((p) => !p.free).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
          {url && !preset && <option value="custom">Свой адрес</option>}
        </Select>
      </Field>
      {preset && (
        <div className="space-y-1.5 rounded-xl bg-primary/10 p-3 text-sm">
          <div><Badge tone={preset.free ? 'success' : 'warning'}>{preset.free ? 'Бесплатно' : 'Платно'}</Badge></div>
          <div><b>Как получить ключ:</b> {preset.steps} <a href={preset.link} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">Открыть</a></div>
          <div className="text-muted">{preset.limit}</div>
          {preset.warn && <div className="text-warning">⚠ {preset.warn}</div>}
        </div>
      )}
      {preset ? (
        <Field label="Модель">
          <Select value={inList ? model : '__custom'} onChange={(e) => e.target.value !== '__custom' && set(f('model'), e.target.value)}>
            {preset.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            <option value="__custom">Своя модель…</option>
          </Select>
        </Field>
      ) : null}
      {(!preset || !inList) && (
        <div className="grid gap-3 md:grid-cols-2">
          {!preset && <Field label="Адрес API (…/v1)"><Input value={url} onChange={(e) => set(f('base_url'), e.target.value)} placeholder="https://…/v1" autoCapitalize="none" /></Field>}
          <Field label="Своя модель" hint="ID из кабинета провайдера"><Input value={model} onChange={(e) => set(f('model'), e.target.value)} autoCapitalize="none" /></Field>
        </div>
      )}
      <Field label="API-ключ"><Input type="password" autoComplete="off" value={v[f('key')] ?? ''} onChange={(e) => set(f('key'), e.target.value)} placeholder="Вставьте ключ" /></Field>
      <div className="space-y-2">
        <Button size="sm" variant="secondary" type="button" loading={loadModels.isPending} disabled={!url} onClick={() => loadModels.mutate()}>Загрузить модели по ключу</Button>
        {fetched && (
          <div className="space-y-2">
            {fetched.length > 12 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск модели (например, claude, gpt, gemini)" autoCapitalize="none" />}
            <Select value={fetched.includes(model) ? model : ''} onChange={(e) => e.target.value && set(f('model'), e.target.value)}>
              <option value="">{shown.length ? `Выберите модель (${shown.length})` : 'Ничего не найдено'}</option>
              {shown.map((id) => <option key={id} value={id}>{id}</option>)}
            </Select>
            <div className="text-xs text-muted">Для поддержки подойдут недорогие быстрые модели. После выбора нажмите «Сохранить», затем «Проверить подключение».</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiSettings({ data, locked }: { data: any; locked: boolean }) {
  const {get,post,patch,put,del,loadSupportPhoto}=useApi();
  const [res, setRes] = useState<{ ok: boolean; text: string }[] | null>(null);
  const test = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; sample?: string; ms?: number; fallback?: { ok: boolean; error?: string; sample?: string; ms?: number } }>('/support/test-ai'),
    onSuccess: (r) => setRes([
      { ok: r.ok, text: (r.fallback ? 'Основной: ' : '') + (r.ok ? `отвечает (${r.ms} мс): «${r.sample}»` : r.error ?? 'Ошибка') },
      ...(r.fallback ? [{ ok: r.fallback.ok, text: 'Запасной: ' + (r.fallback.ok ? `отвечает (${r.fallback.ms} мс): «${r.fallback.sample}»` : r.fallback.error ?? 'Ошибка') }] : []),
    ]),
    onError: (e) => setRes([{ ok: false, text: errMsg(e) }]),
  });
  return (
    <div className="space-y-5">
      <GroupForm group="support" data={data} locked={locked} title="ИИ-помощник и поддержка" description="Любой провайдер, совместимый с OpenAI API. Для старта выберите бесплатный вариант — позже можно сменить на платный в один клик. Ключи хранятся в зашифрованном виде и не показываются.">
        {(v, set) => (<>
          <Toggle label="Раздел «Поддержка» включён" hint="Чат и тикеты в приложении и боте. Выключено — кнопка ведёт на аккаунт поддержки" checked={v.enabled} onChange={(x) => set('enabled', x)} />
          <Toggle label="ИИ-помощник отвечает в чатах" hint="Выключите, если хотите отвечать сами: тогда все обращения сразу идут вам" checked={v.ai_enabled} onChange={(x) => set('ai_enabled', x)} />
          {!v.ai_base_url && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-3 text-sm">
              <span>Нужен бесплатный вариант? Начните с Groq — без карты, хватает на небольшой сервис.</span>
              <Button size="sm" type="button" onClick={() => { const p = PRESETS[0]!; set('ai_base_url', p.url); set('ai_model', p.models[0]!.id); set('ai_global_limit', p.cap!); }}>Выбрать Groq</Button>
            </div>
          )}
          <ProviderBlock v={v} set={set} prefix="" title="Основной провайдер" hint="Отвечает на все вопросы" />
          <ProviderBlock v={v} set={set} prefix="fallback_" title="Запасной провайдер (необязательно)" hint="Если у основного кончился бесплатный лимит или он не ответил — ответит запасной, и клиент ничего не заметит. Удобно: основной Groq, запасной OpenRouter" />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Вопросов ИИ в сутки на человека"><Input type="number" min={1} max={500} value={v.ai_daily_limit} onChange={(e) => set('ai_daily_limit', Number(e.target.value))} /></Field>
            <Field label="Всего вопросов ИИ в сутки" hint="У бесплатных тарифов поставится автоматически. Когда лимит кончится — диалоги пойдут вам"><Input type="number" min={10} value={v.ai_global_limit} onChange={(e) => set('ai_global_limit', Number(e.target.value))} /></Field>
            <Field label="Длина ответа, токенов" hint="Меньше — короче и дешевле"><Input type="number" min={100} max={1500} value={v.ai_max_tokens} onChange={(e) => set('ai_max_tokens', Number(e.target.value))} /></Field>
          </div>
          <Field label="Знания о сервисе" hint="Известные проблемы, правила, нюансы, которые ИИ должен учитывать (тарифы, локации и статус подписки клиента ИИ видит сам)">
            <Textarea value={v.knowledge} maxLength={6000} onChange={(e) => set('knowledge', e.target.value)} placeholder="Например: Сервер в Германии иногда медленный вечером — советуем Нидерланды. Приложение для iPhone — Happ…" className="!min-h-32" />
          </Field>
          <Toggle label="Фильтр мата" hint="Грубые сообщения не доходят ни до ИИ, ни до операторов; три нарушения — временная блокировка чата" checked={v.filter_profanity} onChange={(x) => set('filter_profanity', x)} />
          <Toggle label="Автоэскалация в тикет" hint="Деньги и платежи, просьба позвать человека, неуверенность ИИ, сбой — диалог сам переходит к вам" checked={v.auto_escalate} onChange={(x) => set('auto_escalate', x)} />
          <Toggle label="Уведомлять админов в Telegram" checked={v.notify_admins} onChange={(x) => set('notify_admins', x)} />
          <Field label="Блокировка чата за нарушения, минут"><Input type="number" min={1} max={1440} value={v.mute_minutes} onChange={(e) => set('mute_minutes', Number(e.target.value))} /></Field>
        </>)}
      </GroupForm>
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={<Plug className="h-4 w-4" />} loading={test.isPending} onClick={() => test.mutate()}>Проверить подключение к ИИ</Button>
          <span className="text-sm text-muted">Сначала сохраните настройки выше</span>
        </div>
        {res?.map((r, i) => <div key={i} className={cn('flex items-center gap-1.5 text-sm', r.ok ? 'text-success' : 'text-danger')}>{r.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}{r.text}</div>)}
      </Card>
    </div>
  );
}

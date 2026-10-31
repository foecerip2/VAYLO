import { Badge, Button, Card, ErrorState, Input, KpiTile, Select, Tabs, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CheckCheck, RefreshCw, Search, ShieldCheck, Trash2, UserRoundCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageTitle, DataTable, Pagination, type Column } from '../components/kit';
import { get, post, ApiError } from '../lib/api';
import { fmtDateTime } from '../lib/format';
interface Candidate {id:string;tg_id:number|null;first_name:string|null;username:string|null;expires_at:string|null;eligible_after:string|null;eligible:boolean;reasons:{code:string;label:string}[];provider_checks:number;rw_id:number|null;rw_username:string|null}
interface Candidates {stats:{total:number;eligible:number;excluded:number};total:number;page:number;limit:number;items:Candidate[]}
interface Plan {id:string;total:number;batchSize:number;expiresAt:string;items:Candidate[]}
interface Checks {localDeleted:boolean|null;remnawaveDeleted:boolean|null;trialBlocked:boolean;returned?:boolean;remoteState?:string}
interface Result {id:string;status:'deleted'|'skipped'|'failed';tgId?:number;checks?:Checks;stage?:string;error?:string;reason?:string}
interface Run {id:string;state:'ready'|'running'|'done'|'failed';results:Result[]}
interface Registry {total:number;page:number;limit:number;items:{tg_id:number;cleaned_at:string;last_verified_at:string|null;verification:Checks|null;current_user_id:string|null;source_user_id?:string|null;first_name:string|null;username:string|null;rw_username:string|null;trial_blocked:boolean}[]}
const errorText=(e:unknown)=>e instanceof ApiError?e.message:'Не удалось выполнить операцию';
const stages:Record<string,string>={payments:'Проверка оплаты',identity:'Связь с профилем',remnawave:'Remnawave',remote_verification:'Проверка панели',local_verification:'Локальная проверка'};
export default function TrialCleanup() {
 const [tab,setTab]=useState<'candidates'|'registry'>('candidates');
 const [filter,setFilter]=useState<'eligible'|'excluded'|'all'>('eligible'),[registryFilter,setRegistryFilter]=useState<'all'|'returned'|'unverified'>('all');
 const [search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),[page,setPage]=useState(1);
 const [plan,setPlan]=useState<Plan|null>(null),[runId,setRunId]=useState(''),[confirm,setConfirm]=useState('');
 const [resultFilter,setResultFilter]=useState('all');const toast=useToast(),qc=useQueryClient();
 useEffect(()=>{const timer=setTimeout(()=>{setDebounced(search);setPage(1);setPlan(null);setConfirm('');},300);return()=>clearTimeout(timer);},[search]);
 const candidates=useQuery({queryKey:['trial-cleanup-candidates',filter,debounced,page],enabled:tab==='candidates',retry:false,
  queryFn:()=>get<Candidates>(`/trial-cleanup/candidates?filter=${filter}&q=${encodeURIComponent(debounced)}&page=${page}`)});
 const registry=useQuery({queryKey:['trial-cleanup-registry',registryFilter,debounced,page],enabled:tab==='registry',retry:false,
  queryFn:()=>get<Registry>(`/trial-cleanup/registry?filter=${registryFilter}&q=${encodeURIComponent(debounced)}&page=${page}`)});
 const preview=useMutation({mutationFn:()=>post<Plan>('/trial-cleanup/preview',{q:debounced}),onSuccess:p=>{setPlan(p);setRunId('');setConfirm('');setResultFilter('all');},onError:e=>toast(errorText(e),'error')});
 const run=useQuery({queryKey:['trial-cleanup',runId],queryFn:()=>get<Run>(`/trial-cleanup/${runId}`),enabled:!!runId,retry:false,
  refetchInterval:q=>q.state.data?.state==='done'||q.state.data?.state==='failed'?false:1500});
 useEffect(()=>{if(run.data?.state==='done'||run.data?.state==='failed'){
  void qc.invalidateQueries({queryKey:['trial-cleanup-candidates']});void qc.invalidateQueries({queryKey:['trial-cleanup-registry']});void qc.invalidateQueries({queryKey:['users']});
 }},[run.data?.state,runId,qc]);
 const start=useMutation({mutationFn:()=>post<{id:string}>(`/trial-cleanup/${plan!.id}/run`,{confirm:'DELETE_EXPIRED_TRIALS'}),onSuccess:r=>setRunId(r.id),onError:e=>toast(errorText(e),'error')});
 const verify=useMutation({mutationFn:(tgId:number)=>post<Checks>(`/trial-cleanup/registry/${tgId}/verify`),onSuccess:()=>{void qc.invalidateQueries({queryKey:['trial-cleanup-registry']});toast('Результат проверки обновлён','success');},onError:e=>toast(errorText(e),'error')});
 const busy=start.isPending||!!runId&&(!run.data||run.data.state==='running');
 const cols:Column<Candidate>[]=[
  {key:'user',header:'Пользователь',primary:true,render:u=><div><Link to={`/users?userId=${u.id}`} className="font-semibold text-primary">{u.first_name??'Без имени'}</Link><p className="mt-1 text-xs text-muted">{u.username?'@'+u.username+' · ':''}TG {u.tg_id??'—'}</p>{u.rw_username&&<p className="text-xs text-muted">{u.rw_username}</p>}</div>},
  {key:'end',header:'Окончание доступа',render:u=><div>{fmtDateTime(u.expires_at)}{u.reasons.some(r=>r.code==='grace')&&<p className="mt-1 text-xs text-muted">Очистка после {fmtDateTime(u.eligible_after)}</p>}</div>},
  {key:'reason',header:'Результат проверки',render:u=><div className="max-w-md space-y-1">{u.eligible?<Badge tone="success">Подходит для удаления</Badge>:u.reasons.map(r=><p key={r.code} className="whitespace-normal text-xs text-muted">{r.label}</p>)}{u.provider_checks>0&&<p className="whitespace-normal text-xs text-warning">Перед удалением: проверка {u.provider_checks} отменённых заявок у провайдера</p>}</div>},
 ];
 const regCols:Column<Registry['items'][number]&{id:number}>[]=[
  {key:'tg',header:'Пользователь',primary:true,render:r=><div><b>TG {r.tg_id}</b><p className="mt-1 text-xs text-muted">{r.rw_username??'Старая запись без имени профиля'}</p>{r.current_user_id&&<Link className="text-xs text-primary" to={`/users?userId=${r.current_user_id}`}>{r.current_user_id===r.source_user_id?'Локальная запись восстановлена':'Снова зарегистрирован'}{r.first_name?': '+r.first_name:''}</Link>}</div>},
  {key:'date',header:'Удаление / проверка',render:r=><div className="text-xs">{fmtDateTime(r.cleaned_at)}<p className="mt-1 text-muted">Проверено: {fmtDateTime(r.last_verified_at)}</p></div>},
  {key:'proof',header:'Проверка удаления',render:r=><div className="space-y-1 text-xs"><p>{r.verification?.localDeleted===true?'✓ Старая локальная запись удалена':r.verification?.localDeleted===false?'⚠ Локальная запись найдена':'Локальное удаление не проверено'}</p><p>{r.verification?.remnawaveDeleted===true?'✓ Старый профиль Remnawave отсутствует':r.verification?.remoteState==='returned'?'Профиль создан заново после возврата':r.verification?.remoteState==='legacy_present'?'⚠ Найден профиль по Telegram ID; нужна сверка':r.verification?.remoteState==='unavailable'?'Нет связи с Remnawave':r.verification?.remnawaveDeleted===false?'⚠ Профиль найден в Remnawave':'Удаление в панели не проверено'}</p></div>},
  {key:'block',header:'Повторный триал',render:()=> <Badge tone="success">Запрещён по Telegram ID</Badge>},
  {key:'verify',header:'',render:r=><Button size="sm" variant="secondary" loading={verify.isPending&&verify.variables===r.tg_id} onClick={()=>verify.mutate(r.tg_id)} icon={<CheckCheck className="h-4 w-4"/>}>Проверить</Button>},
 ];
 return <div className="space-y-5">
  <PageTitle title="Очистка пробных аккаунтов" subtitle="Истёкший триал без оплаты: диагностика, удаление и запрет повторного теста"/>
  <Tabs value={tab} onChange={v=>{setTab(v);setPage(1);setSearch('');setPlan(null);setConfirm('');}} items={[{value:'candidates',label:'Кандидаты и причины'},{value:'registry',label:'Удалённые · запрет триала'}]}/>
  <Card className="flex items-start gap-3 p-5"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary"/><div className="space-y-2 text-sm text-muted"><p>Удаляются локальная учётная запись бота/мини-приложения и профиль Remnawave. Успех отмечается после проверки отсутствия профиля в панели. Telegram ID остаётся в реестре: повторный вход разрешает покупку, но не выдачу нового триала.</p><p className="text-xs">Оплаты, средства на балансе, подарки, открытые обращения и другие защищённые данные исключаются с объяснением причины. Отменённая заявка сама по себе не является оплатой: при наличии внешнего ID перед удалением сверяется её статус у провайдера.</p></div></Card>
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="relative min-w-64 flex-1 md:max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"/><Input className="pl-9" value={search} onChange={e=>setSearch(e.target.value)} disabled={busy} placeholder={tab==='candidates'?'Имя, @username или Telegram ID':'Telegram ID или имя профиля'} aria-label="Поиск очистки"/></div><Button variant="secondary" icon={<RefreshCw className="h-4 w-4"/>} loading={tab==='candidates'?candidates.isFetching:registry.isFetching} onClick={()=>void(tab==='candidates'?candidates.refetch():registry.refetch())}>Обновить список</Button></div>
  {tab==='candidates'?<>
   <div className="grid gap-3 sm:grid-cols-3"><KpiTile label="Пробные аккаунты" value={candidates.data?.stats.total??'—'} icon={<UserRoundCheck className="h-5 w-5"/>}/><KpiTile label="Подходят для удаления" value={candidates.data?.stats.eligible??'—'} tone="success"/><KpiTile label="Исключены с причиной" value={candidates.data?.stats.excluded??'—'}/></div>
   <Tabs value={filter} onChange={v=>{setFilter(v);setPage(1);setPlan(null);setConfirm('');}} items={[{value:'eligible',label:'К удалению'},{value:'excluded',label:'Почему не попали'},{value:'all',label:'Все пробные'}]}/>
   {candidates.isError?<ErrorState message={errorText(candidates.error)} onRetry={()=>candidates.refetch()}/>:<><DataTable columns={cols} rows={candidates.data?.items} loading={candidates.isLoading} empty="Аккаунты с такими условиями не найдены"/>{candidates.data&&<Pagination page={candidates.data.page} limit={candidates.data.limit} total={candidates.data.total} onChange={setPage}/>}</>}
   {!busy&&filter!=='excluded'&&<Button icon={<Search className="h-4 w-4"/>} loading={preview.isPending} disabled={!candidates.data?.stats.eligible||search!==debounced} onClick={()=>preview.mutate()}>Подготовить список удаления</Button>}
   {plan&&!runId&&<Card className="space-y-4 border-danger/30 p-5"><h2 className="text-lg font-bold">К удалению в этом запуске: {plan.batchSize} из {plan.total}</h2><p className="text-sm text-muted">Список учитывает поиск. До 100 аккаунтов за запуск; действителен до {fmtDateTime(plan.expiresAt)}. Перед удалением каждый проверяется повторно.</p><div className="max-h-56 overflow-auto rounded-xl bg-fg/[.03] p-3 text-xs text-muted">{plan.items.map(u=><p key={u.id} className="py-1">TG {u.tg_id} · {u.first_name??u.username??u.id} · триал до {fmtDateTime(u.expires_at)}</p>)}</div>{plan.batchSize>0&&<><label className="block text-sm">Для подтверждения введите <b>УДАЛИТЬ</b><Input className="mt-2 max-w-sm" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="УДАЛИТЬ"/></label><Button variant="danger" icon={<Trash2 className="h-4 w-4"/>} disabled={confirm!=='УДАЛИТЬ'} loading={start.isPending} onClick={()=>start.mutate()}>Удалить аккаунты из списка</Button></>}</Card>}
  </>:<>
   <Select className="!w-auto" value={registryFilter} aria-label="Фильтр реестра" onChange={e=>{setRegistryFilter(e.target.value as typeof registryFilter);setPage(1);}}><option value="all">Все удалённые</option><option value="returned">Вернулись в бот</option><option value="unverified">Нужна проверка удаления</option></Select>
   {registry.isError?<ErrorState message={errorText(registry.error)} onRetry={()=>registry.refetch()}/>:<><DataTable columns={regCols} rows={registry.data?.items.map(r=>({...r,id:r.tg_id}))} loading={registry.isLoading} empty="В реестре нет записей"/>{registry.data&&<Pagination page={registry.data.page} limit={registry.data.limit} total={registry.data.total} onChange={setPage}/>}</>}
   <p className="text-xs text-muted">Реестр хранится независимо от удалённых аккаунтов. Записи старых версий тоже запрещают повторный триал, но без старого ID/имени профиля удаление в панели может быть непроверяемым. Кнопка «Проверить» только читает данные и не удаляет вернувшегося пользователя.</p>
  </>}
  {runId&&<Card className="space-y-3 p-5"><h2 className="font-bold">{run.data?.state==='done'?'Очистка завершена':run.data?.state==='failed'?'Очистка прервана':'Выполняется очистка…'}</h2>{run.isError&&<ErrorState message={errorText(run.error)} onRetry={()=>run.refetch()}/>}<p className="text-sm text-muted">Удалено и проверено: {run.data?.results.filter(r=>r.status==='deleted').length??0} · пропущено: {run.data?.results.filter(r=>r.status==='skipped').length??0} · ошибок: {run.data?.results.filter(r=>r.status==='failed').length??0}</p><Select className="!w-auto" aria-label="Фильтр результата" value={resultFilter} onChange={e=>setResultFilter(e.target.value)}><option value="all">Все результаты</option><option value="deleted">Удалены и проверены</option><option value="skipped">Пропущены</option><option value="failed">Ошибки</option></Select>{run.data?.results.filter(r=>resultFilter==='all'||r.status===resultFilter).map(r=><div key={r.id} className="space-y-1 rounded-xl bg-fg/[.03] p-3 text-xs"><b>{r.tgId?'TG '+r.tgId:r.id}</b><p className={r.status==='failed'?'text-danger':'text-muted'}>{r.status==='deleted'?'✓ Локальная запись удалена · ✓ Remnawave проверена · ✓ Повторный триал запрещён':r.status==='skipped'?'Пропущен: '+r.reason:(stages[r.stage??'']??'Ошибка')+': '+r.error}</p></div>)}</Card>}
 </div>;
}

import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Button,Card,Field,Input,Select,useToast} from '@vpn/ui';
import {CLIENT_APP_IDS,CLIENT_OS_IDS,CLIENT_APP_NAMES,CLIENT_APP_STATUS,type ClientAppPolicy} from '@vpn/shared';
import {get,post,put,ApiError} from '../lib/api';
const OS={ios:'iPhone / iPad',android:'Android',windows:'Windows',macos:'macOS',linux:'Linux'};
type Draft={text:string;buttonText:string;buttonUrl:string};
export function AppNotices({onDraft,canEdit}:{onDraft:(d:Draft)=>void;canEdit:boolean}){
 const [os,setOs]=useState<typeof CLIENT_OS_IDS[number]>('ios'),[affected,setAffected]=useState<string[]>(['happ','incy']),[alternative,setAlternative]=useState('karing');
 const [both,setBoth]=useState(true);
 const [editing,setEditing]=useState<ClientAppPolicy[]|null>(null);const toast=useToast(),qc=useQueryClient();
 const q=useQuery({queryKey:['client-app-settings'],queryFn:()=>get<{settings:{client_apps:{entries:ClientAppPolicy[]}}}>('/settings')});
 const entries=editing??q.data?.settings.client_apps.entries??[];
 const row=(id:string)=>entries.find(e=>e.id===id&&e.os===os)??{id:id as ClientAppPolicy['id'],os,status:'unknown' as const,recommended:false,note:''};
 function change(id:string,patch:Partial<ClientAppPolicy>){const e={...row(id),...patch};if(e.status==='removed')e.recommended=false;setEditing([...entries.filter(r=>r.id!==id||r.os!==os),e]);}
 const error=(e:unknown)=>toast(e instanceof ApiError?e.message:'Не удалось выполнить действие','error');
 const save=useMutation({mutationFn:()=>put('/settings/client_apps',{entries}),onSuccess:()=>{setEditing(null);void qc.invalidateQueries({queryKey:['client-app-settings']});void qc.invalidateQueries({queryKey:['config']});toast('Статусы приложений сохранены','success');},onError:error});
 const draft=useMutation({mutationFn:()=>post<Draft>('/broadcasts/app-notice',{os:both?'all':os,affected:both?['happ']:affected,alternative}),onSuccess:onDraft,onError:error});
 const apps=CLIENT_APP_IDS.filter(id=>id!=='streisand'||os==='ios'||os==='macos').filter(id=>id!=='happ'||os!=='linux');
 return <Card className="min-w-0 space-y-4 p-5">
 <div><h2 className="text-lg font-bold">Приложения и рекомендации</h2><p className="text-sm text-muted">Статусы указывает администрация после проверки магазина. Они отображаются при подключении; сохранение настроек само по себе не отправляет рассылку.</p></div>
 <Field label="Платформа"><Select value={os} onChange={e=>{const next=e.target.value as typeof os;setOs(next);setAlternative(next==='ios'||next==='linux'?'karing':'happ');setAffected(next==='linux'?['incy']:['happ','incy']);}}>{CLIENT_OS_IDS.map(id=><option key={id} value={id}>{OS[id]}</option>)}</Select></Field>
 <fieldset disabled={!canEdit} className="space-y-3">{apps.map(id=>{const e=row(id);return <div key={id} className="min-w-0 space-y-2 rounded-xl border border-fg/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b>{CLIENT_APP_NAMES[id]}</b><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={e.recommended} disabled={e.status==='removed'} onChange={v=>change(id,{recommended:v.target.checked})}/>Рекомендуем</label></div><Select aria-label={'Статус '+CLIENT_APP_NAMES[id]} value={e.status} onChange={v=>change(id,{status:v.target.value as ClientAppPolicy['status']})}>{Object.entries(CLIENT_APP_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select><Input aria-label={'Примечание '+CLIENT_APP_NAMES[id]} value={e.note} maxLength={300} onChange={v=>change(id,{note:v.target.value})} placeholder="Регион магазина, дата проверки, что делать"/></div>;})}</fieldset>
 <Button loading={save.isPending} disabled={!editing||!canEdit} onClick={()=>save.mutate()}>Сохранить статусы приложений</Button>
 <div className="space-y-3 border-t border-fg/10 pt-4"><h3 className="font-semibold">Подготовить оповещение</h3><p className="text-xs text-muted">Используются сохранённые статусы. Черновик можно отредактировать, проверить на себе и отправить всем через форму ниже.</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={both} onChange={e=>setBoth(e.target.checked)}/>Общее сообщение для Android и iPhone</label><p className="text-xs text-muted">Общее сообщение использует все сохранённые статусы и рекомендации для Android и iPhone. Для сообщения об одной платформе снимите переключатель.</p><fieldset disabled={both} className="space-y-3"><div className="flex flex-wrap gap-3">{apps.map(id=><label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={affected.includes(id)} onChange={e=>setAffected(e.target.checked?[...affected,id]:affected.filter(a=>a!==id))}/>{CLIENT_APP_NAMES[id]}</label>)}</div><Field label="Рекомендовать вместо них"><Select value={alternative} onChange={e=>setAlternative(e.target.value)}>{apps.filter(id=>row(id).status!=='removed').map(id=><option key={id} value={id}>{CLIENT_APP_NAMES[id]}</option>)}</Select></Field></fieldset><Button variant="secondary" loading={draft.isPending} disabled={Boolean(editing)||(!both&&(!affected.length||row(alternative).status==='removed'))} onClick={()=>draft.mutate()}>Подготовить черновик оповещения</Button></div>
 </Card>;
}

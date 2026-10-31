import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge,Button,Card,ErrorState,Skeleton,Tabs } from '@vpn/ui';
import { bytesToHuman } from '@vpn/shared';
import { get } from '../lib/api';
import { fmtDate,fmtDateTime,rub } from '../lib/format';
import { errMsg } from './GroupForm';
import { Row } from './kit';
interface Order {id:string;source:'manual'|'purchase';name:string;qty:number|null;amount:number|null;status:string;created_at:string;fulfilled_at:string|null;fulfill_failed_at:string|null;reason:string|null;actor:string|null}
interface Result {state:'ready'|'disabled'|'unlinked'|'unavailable';checkedAt:string|null;quota:null|{usedBytes:number;baseBytes:number;extraBytes:number;limitBytes:number;remainingBytes:number;nextExpiry:string|null;optedOut:boolean;inSquad:boolean;remoteStatus:string};orders:{items:Order[];total:number;page:number;limit:number};packages:null|{items:{day:string;bytes:number;grants:number;expiresOn:string;active:boolean}[];total:number;page:number;limit:number}}
const messages={disabled:'Интеграция LTE не подключена.',unlinked:'Профиль пользователя в Remnawave не найден.',unavailable:'Не удалось получить счётчик LTE. Проверьте соединение с Remnawave; история заказов показана ниже.'};
export function UserLte({userId}:{userId:string}){
 const [page,setPage]=useState(1),[tab,setTab]=useState<'orders'|'packages'>('orders');
 const q=useQuery({queryKey:['user-lte',userId,page],queryFn:()=>get<Result>(`/users/${userId}/lte?page=${page}`),retry:false,refetchInterval:60_000,refetchIntervalInBackground:false,staleTime:0});
 const d=q.data,v=d?.quota;
 const pages=Math.max(1,Math.ceil((tab==='orders'?(d?.orders.total??0):(d?.packages?.total??0))/10));
 return <section aria-label="LTE пользователя" className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Трафик и докупки LTE</h3><div className="flex items-center gap-3"><Link className="text-sm text-primary" to={`/lte-activity?q=${userId}`}>Активность LTE</Link><Button size="sm" variant="secondary" loading={q.isFetching} onClick={()=>void q.refetch()}>Обновить LTE</Button></div></div>
  {q.isError?<ErrorState message={errMsg(q.error)} onRetry={()=>q.refetch()}/>:!d?<Skeleton className="h-40"/>:<>
   <Card className="p-4">{v?<>
    <Row label="Базовый LTE-пакет">{bytesToHuman(v.baseBytes)}</Row><Row label="Действующие докупки">+{bytesToHuman(v.extraBytes)}</Row><Row label="Текущий лимит LTE">{bytesToHuman(v.limitBytes)}</Row><Row label="Использовано за окно 30 дней">{bytesToHuman(v.usedBytes)}</Row><Row label="Осталось LTE">{bytesToHuman(v.remainingBytes)}</Row>
    <div className="my-3 h-2 overflow-hidden rounded-full bg-primary/15"><div className="h-full bg-primary" style={{width:`${Math.min(100,v.usedBytes/v.limitBytes*100)}%`}}/></div>
    <Row label="Группа LTE"><Badge tone={v.inSquad?'success':'neutral'}>{v.inSquad?'Пользователь в группе':'Пользователя нет в группе'}</Badge></Row>
    {v.optedOut?<p className="mt-2 text-sm text-warning">LTE отключено вручную администратором.</p>:v.remoteStatus!=='ACTIVE'?<p className="mt-2 text-sm text-muted">Профиль Remnawave неактивен.</p>:v.remainingBytes===0?<p className="mt-2 text-sm text-warning">LTE-пакет израсходован.</p>:!v.inSquad&&<p className="mt-2 text-sm text-muted">Остаток есть. Ожидается синхронизация группы — до 10 минут.</p>}
    <Row label="Ближайшее истечение пакета">{v.nextExpiry?fmtDate(v.nextExpiry+'T12:00:00'):'Нет действующих докупок'}</Row>
    <p className="mt-3 text-xs text-muted">Отдельно от общего безлимитного VPN-трафика. Скользящее окно 30 календарных дней. Проверено: {fmtDateTime(d.checkedAt)}.</p>
   </>:<p className="text-sm text-muted">{messages[d.state as keyof typeof messages]??'Счётчик недоступен'}</p>}</Card>
   <Tabs value={tab} onChange={value=>{setTab(value);setPage(1);}} items={[{value:'orders',label:`Покупки и выдачи (${d.orders.total})`},{value:'packages',label:'Пакеты в счётчике'}]}/>
   {tab==='orders'?<Card className="divide-y divide-border">{d.orders.items.length?d.orders.items.map(o=><div key={`${o.source}:${o.id}`} className="space-y-1 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><b>{o.name}{o.qty!=null?` · +${o.qty} ГБ`:''}</b><span>{o.source==='manual'?'Без оплаты':rub(o.amount??0)}</span></div><div className="flex flex-wrap items-center gap-2"><Badge tone={o.status==='refunded'?'neutral':o.fulfilled_at?'success':o.status==='succeeded'?'warning':'neutral'}>{o.status==='refunded'?'Возврат':o.fulfilled_at?'Выдано':o.status==='succeeded'?(o.fulfill_failed_at?'Ошибка выдачи':'Оплачено, не выдано'):o.status==='pending'?'Ожидает оплаты':o.status==='refunded'?'Возврат':o.status==='canceled'?'Отменено':'Истёк'}</Badge><span className="text-xs text-muted">{fmtDateTime(o.created_at)} · {o.source==='manual'?'Ручная выдача':'Покупка'}</span></div>{o.reason&&<p className="break-words text-xs text-muted">{o.reason}{o.actor?` · ${o.actor}`:''}</p>}</div>):<p className="p-4 text-sm text-muted">{d.orders.total?'На этой странице записей нет':'Покупок и ручных выдач LTE пока нет'}</p>}</Card>:<Card className="divide-y divide-border">{!d.packages?<p className="p-4 text-sm text-muted">История счётчика недоступна.</p>:d.packages.items.length?d.packages.items.map(p=><div key={p.day} className="p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><b>+{bytesToHuman(p.bytes)}</b><Badge tone={p.active?'success':'neutral'}>{p.active?'Учитывается в лимите':'Истёк'}</Badge></div><p className="mt-1 text-xs text-muted">Выдано {fmtDate(p.day+'T12:00:00')} · пакетов: {p.grants} · истечение {fmtDate(p.expiresOn+'T12:00:00')}</p></div>):<p className="p-4 text-sm text-muted">{d.packages.total?'На этой странице пакетов нет':'В счётчике нет дополнительных пакетов'}</p>}<p className="p-3 text-xs text-muted">Группировка по дню выдачи. Здесь также видны пакеты, выданные старым внешним скриптом. Запись не означает наличие оплаты.</p></Card>}
   {pages>1&&<div className="flex items-center gap-3"><Button size="sm" variant="secondary" disabled={page===1||q.isFetching} onClick={()=>setPage(p=>p-1)}>Назад</Button><span className="text-xs text-muted">{page} / {pages}</span><Button size="sm" variant="secondary" disabled={page>=pages||q.isFetching} onClick={()=>setPage(p=>p+1)}>Далее</Button></div>}
  </>}
 </section>;
}

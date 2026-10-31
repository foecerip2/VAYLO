import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button,Input,Select,ErrorState,Badge } from '@vpn/ui';
import { Link } from 'react-router-dom';
import { get } from '../lib/api';
import { rub,fmtDateTime } from '../lib/format';
import { DataTable,Section,type Column } from '../components/kit';
import { errMsg } from '../components/GroupForm';
interface Order {id:string;user_id:string;tg_id:number|null;username:string|null;first_name:string|null;plan_name:string;amount:number;status:string;created_at:string;paid_at:string|null;fulfilled_at:string|null;fulfill_failed_at:string|null;addon:{kind:string;qty:number;days?:number|null;locationId?:string|null}|null}
export function AddonOrders(){
 const [page,setPage]=useState(1),[state,setState]=useState('all'),[input,setInput]=useState(''),[search,setSearch]=useState('');
 const q=useQuery({queryKey:['addon-orders',page,state,search],queryFn:()=>get<{items:Order[];total:number;page:number}>(`/addon-orders?page=${page}&state=${state}&search=${encodeURIComponent(search)}`)});
 const columns:Column<Order>[]=[
  {key:'user',header:'Покупатель',primary:true,render:r=><Link to={`/users?search=${r.tg_id??r.username??''}`} className="text-primary">{r.username?'@'+r.username:r.first_name??r.tg_id??'Пользователь'}</Link>},
  {key:'product',header:'Докупка',render:r=><div>{r.plan_name}<div className="text-xs text-muted">{r.addon?.kind==='devices'?`+${r.addon.qty} устройств`:r.addon?`+${r.addon.qty} ГБ · ${r.addon.kind==='lte'?'LTE · 30 дней':r.addon.kind==='traffic'?'общий трафик':'пакет локации'}`:'Нет снимка товара'}</div></div>},
  {key:'amount',header:'Оплачено',render:r=>rub(r.amount)},
  {key:'status',header:'Выдача',render:r=><Badge tone={r.fulfilled_at?'success':r.status==='succeeded'?'warning':'neutral'}>{r.fulfilled_at?'Выдано':r.status==='succeeded'?(r.fulfill_failed_at?'Ошибка выдачи':'Ожидает выдачи'):r.status==='pending'?'Ожидает оплаты':r.status==='refunded'?'Возврат':r.status==='canceled'?'Отменён':'Истёк'}</Badge>},
  {key:'time',header:'Дата',render:r=>fmtDateTime(r.paid_at??r.created_at)},
 ];
 return <Section title="Заказы докупок" description="Снимок товара и фактический статус выдачи. Оплаченный заказ без выдачи требует проверки в разделе «Платежи».">
  <form className="mb-4 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setPage(1);setSearch(input.trim());}}>
   <Input className="max-w-xs" value={input} maxLength={80} onChange={e=>setInput(e.target.value)} placeholder="Telegram ID, username или товар" aria-label="Поиск заказов" />
   <Button type="submit" variant="secondary">Найти</Button>
   <Select className="max-w-xs" value={state} onChange={e=>{setState(e.target.value);setPage(1);}} aria-label="Статус заказа"><option value="all">Все заказы</option><option value="pending">Ожидают оплаты</option><option value="issued">Выданы</option><option value="unfulfilled">Оплачены без выдачи</option><option value="failed">Отменены / возврат</option></Select>
  </form>
  {q.isError?<ErrorState message={errMsg(q.error)} onRetry={()=>q.refetch()}/>:<DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} empty="Заказов докупок пока нет"/>}
  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted"><span>Всего: {q.data?.total??0} · Страница {page}</span><Button size="sm" variant="secondary" disabled={page<=1||q.isFetching} onClick={()=>setPage(p=>p-1)}>Назад</Button><Button size="sm" variant="secondary" disabled={!q.data||page*30>=q.data.total||q.isFetching} onClick={()=>setPage(p=>p+1)}>Далее</Button></div>
 </Section>;
}

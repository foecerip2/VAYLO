import { AddonOrders } from './AddonOrders';
import { Badge, Button, Card, Field, Input, Select, Sheet, Switch, ErrorState, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, Section, type Column } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { rub } from '../lib/format';

interface Loc { id: string; name: string; country_code: string | null; description: string; squad_uuid: string; is_active: boolean; sort: number; users: number }
interface Addon { id: string; kind: 'devices' | 'traffic' | 'location' | 'lte'; name: string; description: string; price: number; qty: number; location_id: string | null; location_name: string | null; duration_days: number | null; is_active: boolean; sort: number; sold: number }
const KIND = { lte:'Трафик LTE · белые списки', devices: 'Устройства', traffic: 'Старый общий трафик', location: 'Старый пакет локации' } as const;
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка');

export default function CatalogPage() {
  const { can } = useAuth();
  const canEdit = can('admin');
  const lte=useQuery({queryKey:['lte-status'],queryFn:()=>get<{configured:boolean;ready:boolean}>('/lte-status'),enabled:canEdit});
  return (
    <div className="animate-fade-up space-y-5">
      <PageTitle title="Докупки устройств и LTE" subtitle="Устройства расширяют лимит подключений. Пакеты LTE добавляют ГБ на 30 календарных дней и возвращают доступ к группе LTE. Общий VPN-трафик безлимитный." />

      {canEdit&&<Card className="p-4 text-sm">Учёт LTE: {lte.isLoading?"проверяем…":lte.data?.ready?"подключён · 5 ГБ / 30 дней · нода №2":"не подключён или недоступен. Выполните scripts/connect-lte.sh на сервере Remnawave перед продажей LTE-пакетов."}</Card>}
      <Addons canEdit={canEdit} />
      {canEdit&&<ManualLteGrant/>}
      <AddonOrders />
    </div>
  );
}

function Addons({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['addons-admin'], queryFn: () => get<Addon[]>('/addons') });
  const locs = useQuery({ queryKey: ['locations'], queryFn: () => get<Loc[]>('/locations') });
  interface Form { id?: string; kind: Addon['kind']; name: string; description: string; price: string; qty: string; locationId: string; durationDays: string; isActive: boolean; sort: string }
  const [f, setF] = useState<Form | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['addons-admin'] });
  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = { kind: v.kind, name: v.name.trim(), description: v.description.trim(), price: Math.round(Number(v.price.replace(',', '.')) * 100), qty: Number(v.qty), locationId: v.kind === 'location' ? v.locationId || null : null, durationDays: v.kind==='lte'?30:v.kind === 'location' && v.durationDays ? Number(v.durationDays) : null, isActive: v.isActive, sort: Number(v.sort) || 0 };
      return v.id ? put(`/addons/${v.id}`, body) : post('/addons', body);
    },
    onSuccess: () => { void refresh(); setF(null); toast('Товар сохранён', 'success'); },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const toggle = useMutation({
    mutationFn: (a: Addon) => put(`/addons/${a.id}`, { kind: a.kind, name: a.name, description: a.description, price: a.price, qty: a.qty, locationId: a.location_id, durationDays: a.duration_days, isActive: !a.is_active, sort: a.sort }),
    onSuccess: () => void refresh(),
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/addons/${id}`), onSuccess: () => { void refresh(); toast('Удалён', 'success'); }, onError: (e) => toast(errMsg(e), 'error') });
  const unit = (a: Pick<Addon, 'kind' | 'qty'>) => (a.kind === 'devices' ? `+${a.qty} устр.` : a.kind === 'traffic' ? `+${a.qty} ГБ` : `${a.qty} ГБ`);
  const cols: Column<Addon>[] = [
    { key: 'n', header: 'Товар', primary: true, render: (a) => <b>{a.name}</b> },
    { key: 'k', header: 'Тип', render: (a) => <div>{KIND[a.kind]}{a.location_name ? ` · ${a.location_name}` : ''}{(a.kind==='traffic'||a.kind==='location')&&<p className="mt-1 text-xs text-warning">Не продаётся в LTE-магазине. Если это пакет LTE — откройте товар и смените тип на «Трафик LTE».</p>}</div> },
    { key: 'q', header: 'Объём', render: (a) => unit(a) + (a.kind === 'lte'?' · 30 дней':a.kind === 'location' ? (a.duration_days ? ` · ${a.duration_days} дн.` : ' · до перерыва подписки') : '') },
    { key: 'p', header: 'Цена', render: (a) => rub(a.price) },
    { key: 'sold', header: 'Выдано', render: (a) => a.sold },
    { key: 's', header: 'Статус', render: (a) => canEdit ? <span onClick={(e) => e.stopPropagation()}><Switch checked={a.is_active} onChange={() => toggle.mutate(a)} label="Активен" /></span> : <Badge tone={a.is_active ? 'success' : 'neutral'}>{a.is_active ? 'Активен' : 'Выкл.'}</Badge> },
    { key: 'x', header: '', align: 'right', render: (a) => canEdit && <Button size="sm" variant="ghost" aria-label="Удалить" icon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить «${a.name}»?`)) remove.mutate(a.id); }} /> },
  ];
  const valid = f && f.name.trim() && Number(f.price.replace(',', '.')) >= 0 && Number.isInteger(Number(f.qty)) && Number(f.qty) >= 1 && Number(f.qty) <= 100000 && (f.kind !== 'location' || f.locationId);
  return (
    <Section title="Товары докупки" description="Цены в рублях. Персональная скидка клиента применяется автоматически." right={canEdit && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setF({ kind: 'devices', name: '', description: '', price: '50', qty: '1', locationId: '', durationDays: '', isActive: true, sort: '10' })}>Добавить</Button>}>
      {q.isError && <ErrorState message={errMsg(q.error)} onRetry={()=>q.refetch()} />}
      <DataTable columns={cols} rows={q.data} loading={q.isLoading} empty="Товаров пока нет" onRowClick={canEdit ? (a) => setF({ id: a.id, kind: a.kind, name: a.name, description: a.description, price: String(a.price / 100), qty: String(a.qty), locationId: a.location_id ?? '', durationDays: a.duration_days ? String(a.duration_days) : '', isActive: a.is_active, sort: String(a.sort) }) : undefined} />
      {q.data && !q.data.length && <Card className="mt-3 p-4 text-sm text-muted">Пример: «+1 устройство» или «+10 ГБ LTE на 30 дней». Объём и цену задаёте вы.</Card>}
      <Sheet open={Boolean(f)} onClose={() => setF(null)} title={f?.id ? 'Товар' : 'Новый товар'}>
        {f && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(f); }}>
            <Field label="Тип"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Addon['kind'] })}>{Object.entries(KIND).filter(([k])=>k==='devices'||k==='lte'||(f.id&&k===f.kind)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {f.kind==='lte'&&<Card className="p-3 text-sm text-muted">ГБ действуют 30 календарных дней, отдельно от общего VPN-трафика. Доступ к группе LTE восстанавливается после выдачи.</Card>}
            <Field label="Название"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'devices' ? '+2 устройства' : f.kind==='lte'?'+10 ГБ LTE':f.kind === 'traffic' ? '+50 ГБ трафика' : 'Германия, 30 ГБ'} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цена, ₽"><Input type="number" min={0} step={0.01} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
              <Field label={f.kind === 'devices' ? 'Устройств' : 'Гигабайт'}><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            </div>
            {f.kind === 'location' && (
              <>
                <Field label="Локация"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">— выберите —</option>{locs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
                <Field label="Срок доступа, дней" hint="Пусто — без отдельной даты окончания, до перерыва в VPN-подписке"><Input type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
              </>
            )}
            <Field label="Описание"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3 items-end">
              <Field label="Порядок"><Input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
              <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Активен" />
            </div>
            <Button type="submit" full loading={save.isPending} disabled={!valid}>Сохранить</Button>
          </form>
        )}
      </Sheet>
    </Section>
  );
}

function ManualLteGrant(){
 const toast=useToast();const [tgId,setTg]=useState(''),[qty,setQty]=useState('10'),[reason,setReason]=useState(''),[operation,setOperation]=useState(()=>crypto.randomUUID());
 const grant=useMutation({mutationFn:()=>post('/lte-grants',{tgId:Number(tgId),qty:Number(qty),reason,operationId:operation}),onSuccess:()=>{toast('LTE-пакет выдан на 30 календарных дней','success');setOperation(crypto.randomUUID());setReason('');},onError:e=>toast(errMsg(e),'error')});
 return <Section title="Выдать LTE-пакет вручную" description="Без списания денег с пользователя. Требуется активная подписка; действие попадёт в аудит."><form className="space-y-3" onSubmit={e=>{e.preventDefault();grant.mutate();}}><div className="grid gap-3 sm:grid-cols-2"><Field label="Telegram ID"><Input value={tgId} onChange={e=>setTg(e.target.value)} inputMode="numeric" required/></Field><Field label="Гигабайт LTE"><Input type="number" min={1} max={100000} value={qty} onChange={e=>setQty(e.target.value)} required/></Field></div><Field label="Причина выдачи"><Input value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={300} required/></Field><Button type="submit" loading={grant.isPending} disabled={!/^\d+$/.test(tgId)||Number(qty)<1||!Number.isInteger(Number(qty))||reason.trim().length<3}>Выдать пакет без оплаты</Button></form></Section>;
}

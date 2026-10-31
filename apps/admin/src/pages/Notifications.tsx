import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Field, Input } from '@vpn/ui';
import { GroupForm, Toggle, errMsg } from '../components/GroupForm';
import { get, post } from '../lib/api';

type Preview = { text:string; day:string; timezone:string; recipients:number; deliveries:{chat_id:number;sent_at:string|null;attempted_at:string|null;attempts:number}[] };
type PaymentsStatus = {recipients:number;pending:number;failed:number;sent:number;waiting:number;lastSentAt:string|null;example:string;telegramLinked:boolean};
const plain=(text:string)=>text.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
export function Notifications({data,locked}:{data:any;locked:boolean}) {
  const qc=useQueryClient();
  const payments=useQuery({queryKey:['payment-notification-status'],queryFn:()=>get<PaymentsStatus>('/notifications/payments'),refetchInterval:30_000});
  const paymentTest=useMutation({mutationFn:()=>post<{ok:boolean}>('/notifications/payments/test'),onSuccess:()=>void qc.invalidateQueries({queryKey:['payment-notification-status']})});
  const [preview,setPreview] = useState<Preview|null>(null);
  const load = useMutation({mutationFn:()=>get<Preview>('/notifications/preview'),onSuccess:setPreview});
  const test = useMutation({mutationFn:()=>post<{ok:boolean}>('/notifications/test')});
  const sent = preview?.deliveries.filter(d=>d.sent_at).length ?? 0;
  return <div className="space-y-5">
    <GroupForm group="admin_notifications" data={data} locked={locked} title="Уведомления администратора" description="Сообщения об оплатах и ежедневная статистика приходят в бот проекта. Работают независимо от мониторинга.">
      {(v,set)=><>
        <Toggle label="Уведомлять об успешных оплатах" hint="Подписки, подарки, LTE-трафик, устройства и пополнение баланса. Только после подтверждения платежа." checked={v.payments_enabled??true} onChange={x=>set('payments_enabled',x)} />
        <Toggle label="Сообщать о покупках с баланса" hint="Отдельное сообщение с пометкой «Покупка с баланса». Это расход ранее зачисленных средств, а не новая выручка." checked={v.balance_purchases_enabled??true} onChange={x=>set('balance_purchases_enabled',x)} />
        <p className="text-xs leading-relaxed text-muted">Оплаты получают владелец и администраторы с привязанным Telegram ID, а также дополнительный чат ниже. Сотрудникам с ролями «Поддержка» и «Аналитик» личные уведомления об оплатах не отправляются.</p>
        <div className="border-t border-fg/10 pt-4 text-sm font-semibold">Ежедневный отчёт</div>
        <Toggle label="Присылать ежедневную статистику" checked={v.daily_enabled} onChange={x=>set('daily_enabled',x)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Время отправки"><Input type="time" value={v.daily_time} onChange={e=>set('daily_time',e.target.value)} /></Field>
          <Field label="Часовой пояс" hint="Например, Europe/Moscow, Asia/Yekaterinburg или UTC"><Input value={v.timezone} onChange={e=>set('timezone',e.target.value.trim())} /></Field>
        </div>
        <Field label="Дополнительный чат" hint="Для оплат и ежедневных отчётов. Числовой ID группы или канала; бот должен иметь право отправлять сообщения."><Input value={v.extra_chat_id} onChange={e=>set('extra_chat_id',e.target.value.trim())} placeholder="-1001234567890" /></Field>
        <Card className="p-4 text-sm text-muted">Привяжите Telegram ID в разделе «Администраторы» и запустите бота кнопкой /start. Ежедневный отчёт получают все администраторы с Telegram ID. Уведомления об оплатах начинают накапливаться после установки обновления.</Card>
      </>}
    </GroupForm>
    <Card className="min-w-0 space-y-4 p-5">
      <div><h2 className="font-display text-lg font-bold">Проверка уведомлений об оплате</h2><p className="text-sm text-muted">Тест приходит только вам. Он не создаёт платёж, не списывает деньги и не меняет подписку.</p></div>
      {payments.data&&<>
        <p className="text-sm text-muted">Получателей: {payments.data.recipients} · Доставлено: {payments.data.sent} · В очереди: {payments.data.pending} · Ожидают настройки получателей: {payments.data.waiting}</p>
        {!payments.data.telegramLinked&&<p role="status" className="text-warning">К вашему администратору не привязан Telegram ID. Укажите его в разделе «Администраторы» и запустите бота проекта.</p>}
        {payments.data.failed>0&&<p role="status" className="text-warning">Не доставлено: {payments.data.failed}. Проверьте Telegram ID, доступ бота к чату и блокировку бота. Система повторит отправку автоматически.</p>}
        <details><summary className="cursor-pointer text-sm font-semibold text-primary">Пример сообщения</summary><pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-surface-2 p-4 font-sans text-sm leading-relaxed">{plain(payments.data.example)}</pre></details>
      </>}
      <Button loading={paymentTest.isPending} disabled={payments.data?.telegramLinked===false} onClick={()=>paymentTest.mutate()}>Тест оплаты — отправить мне</Button>
      {(payments.error||paymentTest.error)&&<p role="alert" className="text-danger">{errMsg(payments.error??paymentTest.error)}</p>}
      {paymentTest.data&&<p role="status" className={paymentTest.data.ok?'text-success':'text-danger'}>{paymentTest.data.ok?'Тест оплаты отправлен в ваш Telegram.':'Telegram не принял сообщение. Проверьте Telegram ID и запустите бота.'}</p>}
    </Card>
    <Card className="space-y-4 p-5">
      <div><h2 className="font-display text-lg font-bold">Проверка отчёта</h2><p className="text-sm text-muted">Используются сохранённые настройки. Предпросмотр ничего не отправляет. Тест приходит только вам и не заменяет ежедневную рассылку.</p></div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" loading={load.isPending} onClick={()=>load.mutate()}>Предпросмотр</Button>
        <Button loading={test.isPending} onClick={()=>test.mutate()}>Отправить тест мне</Button>
      </div>
      {(load.error || test.error) && <p role="alert" className="text-danger">{errMsg(load.error ?? test.error)}</p>}
      {test.data && <p role="status" className={test.data.ok?'text-success':'text-danger'}>{test.data.ok?'Тест отправлен в ваш Telegram.':'Telegram не принял сообщение. Проверьте свой Telegram ID и запустите бота.'}</p>}
      {preview && <>
        <p className="text-sm text-muted">Получателей: {preview.recipients} · Доставлен ежедневный отчёт за {preview.day}: {sent}. Ошибки доставки повторяются каждые 5 минут до конца дня. Предпросмотр показывает свежие значения; отправленный отчёт сохраняет значения на момент формирования.</p>
        <pre className="whitespace-pre-wrap break-words rounded-2xl bg-surface-2 p-4 font-sans text-sm leading-relaxed">{preview.text.replace(/<\/?b>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"')}</pre>
      </>}
    </Card>
  </div>;
}

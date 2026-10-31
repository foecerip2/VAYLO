import { AppNotices } from './AppNotices';
import { Badge, Button, Card, Field, Input, Select, Textarea, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageTitle, Section, type Column } from '../components/kit';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface B { id: string; text: string; segment: string; status: 'queued' | 'sending' | 'done' | 'failed'; total: number; sent: number; failed: number; created_at: string }
const ST = { queued: { l: 'В очереди', t: 'warning' }, sending: { l: 'Отправляется', t: 'primary' }, done: { l: 'Завершена', t: 'success' }, failed: { l: 'Ошибка', t: 'danger' } } as const;

export default function Broadcasts() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [segment, setSegment] = useState('all');
  const [btnText, setBtnText] = useState('');
  const [btnUrl, setBtnUrl] = useState('');
  const [testId, setTestId] = useState('');
  const canSend = can('admin');
  const list = useQuery({ queryKey: ['broadcasts'], queryFn: () => get<{ segments: Record<string, string>; items: B[] }>('/broadcasts'), refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === 'queued' || i.status === 'sending') ? 2000 : false) });
  const preview = useQuery({ queryKey: ['bc-preview', segment], queryFn: () => get<{ count: number }>(`/broadcasts/preview?segment=${segment}`) });
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');

  const send = useMutation({
    mutationFn: () => post('/broadcasts', { text, segment, buttonText: btnText || null, buttonUrl: btnUrl || null }),
    onSuccess: () => { setText(''); setBtnText(''); setBtnUrl(''); void qc.invalidateQueries({ queryKey: ['broadcasts'] }); toast('Рассылка запущена', 'success'); },
    onError,
  });
  const test = useMutation({ mutationFn: () => post('/broadcasts/test', { text, ...(testId?{tgId:Number(testId)}:{}),buttonText:btnText||null,buttonUrl:btnUrl||null }), onSuccess: () => toast('Тестовое сообщение отправлено', 'success'), onError });

  const cols: Column<B>[] = [
    { key: 'd', header: 'Дата', primary: true, render: (b) => fmtDateTime(b.created_at) },
    { key: 's', header: 'Сегмент', render: (b) => list.data?.segments[b.segment] ?? b.segment },
    { key: 't', header: 'Текст', render: (b) => <span className="block max-w-xs truncate">{b.text}</span> },
    { key: 'r', header: 'Доставлено', render: (b) => `${b.sent} / ${b.total}${b.failed ? ` (ошибок: ${b.failed})` : ''}` },
    { key: 'st', header: 'Статус', render: (b) => <Badge tone={ST[b.status].t}>{ST[b.status].l}</Badge> },
  ];
  const urlOk = !btnUrl || /^https?:\/\//.test(btnUrl);
  const valid = text.trim().length > 0 && urlOk && Boolean(btnText)===Boolean(btnUrl);

  return (
    <div className="animate-fade-up space-y-6">
      <PageTitle title="Рассылки" subtitle="Сообщения пользователям бота в Telegram" />
      {canSend && <AppNotices canEdit={can('owner')} onDraft={d=>{setText(d.text);setBtnText(d.buttonText);setBtnUrl(d.buttonUrl);setSegment('all');toast('Черновик готов. Проверьте текст и отправьте тест.', 'info');}}/>}
      {canSend && (
        <Section title="Новая рассылка">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <Field label="Кому"><Select value={segment} onChange={(e) => setSegment(e.target.value)}>{Object.entries(list.data?.segments ?? { all: 'Все пользователи' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Текст" hint={`${text.length}/3500. Поддерживается HTML-разметка Telegram: <b>, <i>, <a href>`}><Textarea value={text} maxLength={3500} onChange={(e) => setText(e.target.value)} className="min-h-36" placeholder="Привет! Скидка 20% до воскресенья…" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Текст кнопки" hint="Необязательно"><Input value={btnText} maxLength={40} onChange={(e) => setBtnText(e.target.value)} /></Field>
                <Field label="Ссылка кнопки" error={urlOk ? undefined : 'Нужна ссылка http(s)://'}><Input value={btnUrl} onChange={(e) => setBtnUrl(e.target.value)} placeholder="https://" /></Field>
              </div>
              <Card className="space-y-3 bg-surface-2 p-4"><b className="text-sm">Предпросмотр черновика</b><pre className="whitespace-pre-wrap break-words font-sans text-sm">{text.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')||'Здесь появится текст сообщения.'}</pre>{btnText&&<p className="break-all text-xs text-primary">{btnText} → {btnUrl}</p>}</Card>
              <div className="flex flex-wrap items-center gap-3">
                <Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!valid || !preview.data?.count} onClick={() => confirm(`Отправить ${preview.data?.count ?? 0} получателям?`) && send.mutate()}>Отправить{preview.data ? ` (${preview.data.count})` : ''}</Button>
                <span className="text-sm text-muted">Получателей: <b className="text-fg">{preview.data?.count ?? '…'}</b></span>
              </div>
            </div>
            <Card className="h-fit bg-surface-2 p-4">
              <div className="mb-2 text-sm font-medium">Тест сообщения и кнопки</div>
              <p className="mb-3 text-xs text-muted">Без заполнения ID тест придёт администратору с привязанным Telegram. Проверяются текст и кнопка; рассылка не запускается.</p>
              <div className="flex gap-2"><Input inputMode="numeric" value={testId} onChange={(e) => setTestId(e.target.value.replace(/\D/g, ''))} placeholder="Ваш ID из профиля админа" /><Button variant="secondary" loading={test.isPending} disabled={!valid} onClick={() => test.mutate()}>Тест</Button></div>
            </Card>
          </div>
        </Section>
      )}
      <div><h2 className="mb-3 font-semibold">История</h2><DataTable columns={cols} rows={list.data?.items} loading={list.isLoading} empty="Рассылок ещё не было" /></div>
    </div>
  );
}

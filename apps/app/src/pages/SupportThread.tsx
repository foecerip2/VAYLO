import { Badge, Button, ErrorState, Skeleton, cn, useToast, ChatFrame, ChatMessages, ChatComposer, useChatScroll, Sheet, SupportPhotos, type SupportDraftPhoto } from '@vpn/ui';
import { SUPPORT_PRIORITY, type SupportMessageDTO } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Headset, MoreHorizontal, ThumbsDown, ThumbsUp, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorText, post, loadSupportPhoto } from '../lib/api';
import { useSupportThread, type SupportThread as Thread } from '../lib/queries';
import { haptic } from '../lib/tg';
import { STATUS_LABEL } from './Support';

const TONE = { normal: 'success', important: 'warning', urgent: 'danger' } as const;
const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function Bubble({ m, onRate, canRate }: { m: SupportMessageDTO; onRate: (id: string, r: 1 | -1) => void; canRate: boolean }) {
  if (m.author === 'system') {
    return <div className="mx-auto max-w-[90%] rounded-2xl bg-surface-2 px-3.5 py-2 text-center text-[13px] text-muted">{m.body}</div>;
  }
  const mine = m.author === 'user';
  return (
    <div className={cn('flex gap-2', mine && 'flex-row-reverse')}>
      {!mine && (
        <div className={cn('mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', m.author === 'ai' ? 'bg-primary/20 text-primary' : 'bg-success/20 text-success')}>
          {m.author === 'ai' ? <Bot className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
        </div>
      )}
      <div className={cn('flex min-w-0 max-w-[82%] flex-col', mine ? 'items-end' : 'items-start', m.attachments?.length && 'w-80')}>
        <div className="mb-0.5 px-1 text-[11px] text-muted">{mine ? 'Вы' : m.author === 'ai' ? 'ИИ-помощник' : 'Поддержка'} · {time(m.createdAt)}</div>
        <div style={mine ? { background: 'var(--button-gradient, linear-gradient(115deg,#7142c8,#5429ad))', color: '#fff' } : undefined} className={cn('whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug', mine ? 'rounded-br-md bg-gradient-to-br from-primary to-primary-2 text-white' : 'rounded-bl-md border border-border bg-surface-2', m.attachments?.length && 'w-full')}>{m.body && <p>{m.body}</p>}<SupportPhotos photos={m.attachments} load={loadSupportPhoto} className={m.body ? 'mt-2' : ''} /></div>
        {m.author === 'ai' && canRate && (
          <div className="mt-1 flex gap-1.5 px-1">
            <button aria-label="Полезно" onClick={() => onRate(m.id, 1)} className={cn('flex h-11 w-11 items-center justify-center rounded-lg transition active:scale-90', m.rating === 1 ? 'bg-success/20 text-success' : 'text-muted hover:text-fg')}><ThumbsUp className="h-3.5 w-3.5" /></button>
            <button aria-label="Не помогло" onClick={() => onRate(m.id, -1)} className={cn('flex h-11 w-11 items-center justify-center rounded-lg transition active:scale-90', m.rating === -1 ? 'bg-danger/20 text-danger' : 'text-muted hover:text-fg')}><ThumbsDown className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SupportThread() {
  const { id = '' } = useParams();
  const nav=useNavigate(),qc=useQueryClient(),toast=useToast();
  const q=useSupportThread(id);
  const [text,setText]=useState(''),[photos,setPhotos]=useState<SupportDraftPhoto[]>([]),[preparing,setPreparing]=useState(false);
  const [pending,setPending]=useState<string|null>(null),[details,setDetails]=useState(false),[acting,setActing]=useState(false);
  const scroll=useChatScroll(`${q.data?.messages.length??0}:${Boolean(pending)}`);
  const setThread=(t:Thread)=>{qc.setQueryData(['support',id],t);void qc.invalidateQueries({queryKey:['support'],exact:true});};
  async function send(){
    const t=text.trim();if((!t&&!photos.length)||pending||preparing||acting)return;
    scroll.jump();setPending(t||'Отправляем фото…');haptic('light');
    try{
      const r=await post<{blocked?:string;thread:Thread}>(`/support/tickets/${id}/messages`,{text:t,photos:photos.map(({image,name})=>({image,name}))});setThread(r.thread);
      if(r.blocked)haptic('error');else{setText('');setPhotos([]);}
    }catch(e){toast(e instanceof ApiError?e.message:errorText(e),'error');}finally{setPending(null);}
  }
  async function rate(mid:string,r:1|-1){try{await post(`/support/messages/${mid}/rate`,{rating:r});haptic('success');await q.refetch();}catch(e){toast(errorText(e),'error');}}
  async function human(){if(acting)return;setActing(true);try{setThread(await post<Thread>(`/support/tickets/${id}/escalate`,{}));setDetails(false);haptic('success');}catch(e){toast(errorText(e),'error');}finally{setActing(false);}}
  async function close(){if(acting)return;setActing(true);try{await post(`/support/tickets/${id}/close`);await qc.invalidateQueries({queryKey:['support']});nav('/support');}catch(e){toast(errorText(e),'error');}finally{setActing(false);}}
  if(q.isLoading)return <div className="space-y-3"><Skeleton className="h-14"/><Skeleton className="h-64"/></div>;
  if(!q.data)return <ErrorState message={errorText(q.error)} onRetry={()=>q.refetch()}/>;
  const {ticket:t,messages}=q.data;
  const muted=q.data.mutedUntil&&new Date(q.data.mutedUntil)>new Date();
  const subject=t.kind==='chat'?'Чат с поддержкой':t.subject||`Обращение №${t.number}`;
  const busy=Boolean(pending)||acting;
  return <>
    <ChatFrame label="Переписка поддержки — клиент">
      <header className="vpn-chat-header"><button type="button" className="vpn-chat-icon" aria-label="Назад" onClick={()=>nav('/support')}><ArrowLeft size={21}/></button><button type="button" className="vpn-chat-title" aria-label="Информация об обращении" onClick={()=>setDetails(true)}><strong>{subject}</strong><small>№{t.number} · {t.mode==='ai'&&t.status!=='closed'?'Отвечает ИИ-помощник':STATUS_LABEL[t.status]}</small></button><button type="button" className="vpn-chat-icon" aria-label="Параметры обращения" onClick={()=>setDetails(true)}><MoreHorizontal size={22}/></button></header>
      {q.isError&&<div role="alert" className="vpn-chat-notice">Не удалось обновить переписку. <button className="underline" onClick={()=>void q.refetch()}>Повторить</button></div>}
      <ChatMessages scroll={scroll}>
        {messages.map(m=><Bubble key={m.id} m={m} onRate={rate} canRate={t.mode==='ai'||t.escalated}/>)}
        {pending&&<><Bubble m={{id:'p',author:'user',body:pending,rating:null,createdAt:new Date().toISOString()}} onRate={rate} canRate={false}/>{t.mode==='ai'&&<div className="pl-10 text-sm text-muted">Помощник печатает…</div>}</>}
      </ChatMessages>
      {muted?<div className="vpn-chat-notice">Отправка сообщений временно ограничена. Подробнее — в меню обращения.</div>:<ChatComposer value={text} onChange={setText} onSend={()=>void send()} photos={photos} onPhotosChange={setPhotos} onPreparingChange={setPreparing} disabled={busy} sending={Boolean(pending)} maxLength={700} placeholder={t.status==='closed'?'Написать — откроем заново':'Ваше сообщение…'} label="Ваше сообщение"/>}
    </ChatFrame>
    <Sheet open={details} onClose={()=>{if(!acting)setDetails(false);}} title="Об обращении">
      <div className="space-y-4"><h3 className="break-words font-bold">{subject}</h3><p className="text-sm text-muted">Обращение №{t.number}</p><div className="flex flex-wrap gap-2"><Badge>{STATUS_LABEL[t.status]}</Badge>{t.kind==='ticket'&&<Badge tone={TONE[t.priority]}>{SUPPORT_PRIORITY[t.priority].emoji} {SUPPORT_PRIORITY[t.priority].label}</Badge>}</div>
        {muted&&<p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">Чат временно закрыт из-за нарушений правил общения.</p>}
        {t.mode==='ai'&&t.status!=='closed'&&<Button full variant="secondary" icon={<UserRound size={16}/>} disabled={busy||preparing} onClick={()=>void human()}>Позвать человека</Button>}
        {t.status!=='closed'?<Button full variant="secondary" disabled={busy||preparing} onClick={()=>void close()}>{t.mode==='ai'?'Вопрос решён':'Закрыть обращение'}</Button>:<p className="text-sm text-muted">Если вопрос остался, напишите в этот диалог — обращение откроется заново.</p>}
      </div>
    </Sheet>
  </>;
}

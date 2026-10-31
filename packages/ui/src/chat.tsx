import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, Paperclip, Send } from 'lucide-react';
import { Sheet } from './components';
import { SupportPhotoPicker, type SupportDraftPhoto } from './support-photos';
import { lockBodyScroll } from './scroll-lock';

const MOBILE='(max-width: 767px), (pointer: coarse) and (max-width: 1100px)';
type TelegramViewport={viewportHeight?:number;onEvent?:(event:string,fn:()=>void)=>void;offEvent?:(event:string,fn:()=>void)=>void};
const telegram=()=> (window as unknown as {Telegram?:{WebApp?:TelegramViewport}}).Telegram?.WebApp;

/** The phone chat is portalled outside animated/contained page ancestors. */
export function ChatFrame({children,label='Переписка',className=''}:{children:ReactNode;label?:string;className?:string}){
  const [mobile,setMobile]=useState(()=>window.matchMedia(MOBILE).matches);
  const box=useRef<HTMLElement>(null);
  useEffect(()=>{const mq=window.matchMedia(MOBILE),change=()=>setMobile(mq.matches);mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change);},[]);
  useEffect(()=>mobile?lockBodyScroll():undefined,[mobile]);
  useLayoutEffect(()=>{
    const el=box.current;if(!el)return;let frame=0,disposed=false;
    if(!mobile&&el.getBoundingClientRect().top<80)window.scrollBy({top:el.getBoundingClientRect().top-80});
    const update=()=>{if(disposed)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const vv=window.visualViewport,tg=telegram();
      const height=Math.min(vv?.height??window.innerHeight,(tg?.viewportHeight??0)>0?tg!.viewportHeight!:Infinity);
      const top=mobile?0:Math.max(0,el.getBoundingClientRect().top-(vv?.offsetTop??0));
      const available=Math.max(120,Math.floor(height-top-(mobile?0:8)));
      el.style.height=available+'px';el.style.setProperty('--chat-visible-height',available+'px');
      el.dataset.short=String(available<500);
      if(mobile){el.style.top=(vv?.offsetTop??0)+'px';el.style.left=(vv?.offsetLeft??0)+'px';el.style.width=(vv?.width??window.innerWidth)+'px';}
      else{el.style.removeProperty('top');el.style.removeProperty('left');el.style.removeProperty('width');}
    });};
    const ro=new ResizeObserver(update);if(el.parentElement&&!mobile)ro.observe(el.parentElement);
    window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);telegram()?.onEvent?.('viewportChanged',update);update();
    void document.fonts?.ready.then(update);
    return()=>{disposed=true;cancelAnimationFrame(frame);ro.disconnect();window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);telegram()?.offEvent?.('viewportChanged',update);};
  },[mobile]);
  const chat=<section ref={box} aria-label={label} className={'vpn-chat '+className} data-mobile={mobile}>{children}</section>;
  return mobile?createPortal(chat,document.body):chat;
}

/** Polling and viewport changes keep the bottom pinned only while reading the latest messages. */
export function useChatScroll(revision:string|number){
  const box=useRef<HTMLDivElement|null>(null),pinned=useRef(true);
  const [element,setElement]=useState<HTMLDivElement|null>(null),[newMessages,setNewMessages]=useState(false);
  const ref=useCallback((el:HTMLDivElement|null)=>{box.current=el;setElement(el);},[]);
  const jump=useCallback(()=>{pinned.current=true;setNewMessages(false);if(box.current)box.current.scrollTop=box.current.scrollHeight;},[]);
  const onScroll=useCallback(()=>{const el=box.current;if(el){pinned.current=el.scrollHeight-el.scrollTop-el.clientHeight<64;if(pinned.current)setNewMessages(false);}},[]);
  useLayoutEffect(()=>{if(!element)return;if(pinned.current)jump();else setNewMessages(true);},[revision,element,jump]);
  useEffect(()=>{if(!element)return;const ro=new ResizeObserver(()=>{if(pinned.current)element.scrollTop=element.scrollHeight;});ro.observe(element);return()=>ro.disconnect();},[element]);
  return{ref,jump,onScroll,newMessages};
}

export function ChatMessages({children,scroll}:{children:ReactNode;scroll:ReturnType<typeof useChatScroll>}){
  return <div className="vpn-chat-body"><div ref={scroll.ref} onScroll={scroll.onScroll} className="vpn-chat-messages">{children}</div>{scroll.newMessages&&<button type="button" className="vpn-chat-new" onClick={scroll.jump}><ArrowDown size={16}/>Новые сообщения</button>}</div>;
}

export function ChatComposer({value,onChange,onSend,photos,onPhotosChange,onPreparingChange,disabled,sending,maxLength=700,placeholder='Ваше сообщение…',label='Сообщение'}:{value:string;onChange:(value:string)=>void;onSend:()=>void;photos:SupportDraftPhoto[];onPhotosChange:(photos:SupportDraftPhoto[])=>void;onPreparingChange?:(busy:boolean)=>void;disabled?:boolean;sending?:boolean;maxLength?:number;placeholder?:string;label?:string}){
  const [attachments,setAttachments]=useState(false),[preparing,setPreparing]=useState(false);
  const input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>()=>onPreparingChange?.(false),[onPreparingChange]);
  useLayoutEffect(()=>{const el=input.current;if(el){el.style.height='0px';el.style.height=Math.min(88,Math.max(44,el.scrollHeight))+'px';}},[value]);
  const send=()=>{if(!disabled&&!preparing&&!sending&&(value.trim()||photos.length))onSend();};
  return <><footer className="vpn-chat-composer">
    {photos.length>0&&<button type="button" className="vpn-chat-drafts" disabled={disabled||preparing} onClick={()=>setAttachments(true)} aria-label="Посмотреть выбранные фото">{photos.map(p=><img key={p.id} src={p.image} alt=""/>)}<span>{photos.length} фото · изменить</span></button>}
    <form onSubmit={e=>{e.preventDefault();send();}} className="vpn-chat-input-row">
      <button type="button" className="vpn-chat-icon" aria-label="Прикрепить фото" title="Прикрепить фото" disabled={disabled||preparing} onClick={()=>setAttachments(true)}><Paperclip size={21}/></button>
      <textarea ref={input} rows={1} value={value} disabled={disabled} maxLength={maxLength} onChange={e=>onChange(e.target.value)} aria-label={label} placeholder={placeholder} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(hover: hover)').matches){e.preventDefault();send();}}}/>
      <button type="submit" className="vpn-chat-icon vpn-chat-send" aria-label="Отправить" title="Отправить" disabled={disabled||preparing||sending||(!value.trim()&&!photos.length)} onMouseDown={e=>e.preventDefault()}>{sending?<span className="vpn-chat-sending"/>:<Send size={20}/>}</button>
    </form>
  </footer><Sheet open={attachments} onClose={()=>{if(!preparing)setAttachments(false);}} title="Фото к сообщению"><div className="space-y-4"><SupportPhotoPicker value={photos} onChange={onPhotosChange} onBusyChange={busy=>{setPreparing(busy);onPreparingChange?.(busy);}} disabled={disabled}/><button type="button" className="vpn-chat-done" disabled={preparing} onClick={()=>setAttachments(false)}>Готово</button></div></Sheet></>;
}

import { useRef,useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button,useToast } from '@vpn/ui';
import { api,errorText } from '../lib/api';
export function AvatarEditor({url,name}:{url?:string|null;name:string}){
 const input=useRef<HTMLInputElement>(null),qc=useQueryClient(),toast=useToast();const [busy,setBusy]=useState(false);
 async function upload(file?:File){if(!file)return;setBusy(true);let objectUrl='';try{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024**2)throw Error('Выберите JPG, PNG или WebP до 8 МБ');
  objectUrl=URL.createObjectURL(file);const image=new Image();image.src=objectUrl;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Не удалось обработать фото');
  const size=Math.min(image.naturalWidth,image.naturalHeight);ctx.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,384,384);
  await api('PUT','/me/avatar',{image:canvas.toDataURL('image/jpeg',.85)});await qc.invalidateQueries({queryKey:['me']});toast('Фото сохранено','success');
 }catch(e){toast(errorText(e),'error');}finally{if(objectUrl)URL.revokeObjectURL(objectUrl);setBusy(false);if(input.current)input.current.value='';}}
 async function remove(){setBusy(true);try{await api('DELETE','/me/avatar');await qc.invalidateQueries({queryKey:['me']});}catch(e){toast(errorText(e),'error');}finally{setBusy(false);}}
 return <div className="flex flex-col items-center gap-2"><button disabled={busy} onClick={()=>input.current?.click()} className="orbit-avatar !h-16 !w-16 overflow-hidden" aria-label="Загрузить своё фото">{url?<img src={url} alt="Ваш аватар" className="h-full w-full object-cover"/>:name.slice(0,1).toUpperCase()}</button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>void upload(e.target.files?.[0])}/><Button variant="ghost" size="sm" loading={busy} onClick={()=>input.current?.click()}>Фото</Button>{url&&<button disabled={busy} className="text-xs text-muted" onClick={()=>void remove()}>Удалить фото</button>}</div>;
}

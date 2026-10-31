import { Button, Switch, Card, useToast } from '@vpn/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi,errMsg } from './context';
export function Toggle({label,hint,checked,onChange}:{label:string;hint?:string;checked:boolean;onChange:(v:boolean)=>void}){
 return <div className="flex items-center justify-between gap-4 py-1"><div className="min-w-0"><div className="text-sm font-medium">{label}</div>{hint&&<p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>}</div><Switch checked={checked} onChange={onChange} label={label}/></div>;
}
export function GroupForm({group,data,title,description,locked,children}:{group:string;data:any;title:string;description?:string;locked?:boolean;children:(v:any,set:(k:string,value:unknown)=>void)=>ReactNode}){
 const api=useApi(),qc=useQueryClient(),toast=useToast();const [v,setV]=useState(data);const [dirty,setDirty]=useState(false);
 useEffect(()=>{if(!dirty)setV(data);},[data,dirty]);
 const save=useMutation({mutationFn:()=>api.put(`/settings/${group}`,v),onSuccess:()=>{setDirty(false);void qc.invalidateQueries({queryKey:['settings']});void qc.invalidateQueries({queryKey:['admin-support-stats']});toast('Настройки сохранены','success');},onError:e=>toast(errMsg(e),'error')});
 return <Card className="space-y-4 p-4 sm:p-5"><div><h2 className="font-bold">{title}</h2>{description&&<p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>}</div><fieldset disabled={locked||save.isPending} className="min-w-0 space-y-4">{children(v,(key,value)=>{setV((old:any)=>({...old,[key]:value}));setDirty(true);})}<Button type="button" disabled={!dirty||locked} loading={save.isPending} onClick={()=>save.mutate()}>Сохранить</Button>{locked&&<p className="text-xs text-muted">Сохранять настройки может владелец проекта.</p>}</fieldset></Card>;
}

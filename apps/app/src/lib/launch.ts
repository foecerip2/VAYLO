import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MeDTO } from '@vpn/shared';
import { get } from './api';

declare global {
  interface Window {
    __vayloLaunch?: {startedAt:number;claim:()=>void;finish:()=>void};
  }
}

/** Observe the existing profile query; never fetch private data before authentication. */
export function useLaunchTransition(status:'loading'|'authed'|'guest'|'error') {
  const me=useQuery({queryKey:['me'],queryFn:()=>get<MeDTO>('/me'),enabled:status==='authed',staleTime:15_000});
  useEffect(()=>{
    if(status!=='loading'&&(status!=='authed'||!me.isPending))window.__vayloLaunch?.finish();
  },[status,me.isPending]);
}

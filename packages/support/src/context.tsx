import { createContext, useContext } from 'react';
import { ROLE_LEVEL, type AdminRole } from '@vpn/shared';
export interface SupportTransport {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  loadSupportPhoto: (id: string) => Promise<Blob>;
}
export const DeskContext = createContext<{api:SupportTransport;role:AdminRole;embedded:boolean}|null>(null);
export function useDesk() { const c=useContext(DeskContext);if(!c)throw new Error('Support desk context missing');return c; }
export function useApi(){return useDesk().api;}
export function useAuth(){const {role}=useDesk();return {can:(min:AdminRole)=>ROLE_LEVEL[role]>=ROLE_LEVEL[min]};}
export const errMsg=(e:unknown)=>e instanceof Error?e.message:'Не удалось выполнить действие';

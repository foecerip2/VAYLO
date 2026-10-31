import { ApiError, getToken as getUserToken, post as userPost } from './api';
import { initDataRaw, isTelegram } from './tg';

let token: string | null = null;
let boundSession: string | null = null;
let pending: Promise<void> | null = null;

/** Запрос кода 2FA у пользователя (регистрирует AdminApp); возвращает null, если пользователь отказался */
let totpPrompt: ((retry: boolean) => Promise<string | null>) | null = null;
export function setTotpPrompt(fn: ((retry: boolean) => Promise<string | null>) | null) {
  totpPrompt = fn;
}

async function exchange(session: string): Promise<void> {
  const initData = isTelegram() ? initDataRaw() : '';
  let totp: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (getUserToken() !== session || boundSession !== session) throw new ApiError(401, 'Сессия изменилась. Откройте админ-панель заново.');
    try {
      const r = await userPost<{ accessToken?: string; needTotp?: boolean }>('/auth/admin-tg', { ...(initData ? { initData } : {}), ...(totp ? { totp } : {}) });
      if (getUserToken() !== session || boundSession !== session) throw new ApiError(401, 'Сессия изменилась. Откройте админ-панель заново.');
      if (r.accessToken) {
        token = r.accessToken;
        return;
      }
      if (!r.needTotp) throw new ApiError(0, 'Не удалось войти в админ-панель');
      const code = totpPrompt ? await totpPrompt(attempt > 0) : null;
      if (!code) throw new ApiError(401, 'Для входа в админ-панель нужен код двухфакторной защиты');
      totp = code;
    } catch (e) {
      // неверный код — спрашиваем ещё раз
      if (e instanceof ApiError && e.status === 401 && totp && totpPrompt && attempt < 4) {
        const code = await totpPrompt(true);
        if (!code) throw e;
        totp = code;
        continue;
      }
      throw e;
    }
  }
  throw new ApiError(401, 'Не удалось подтвердить код 2FA');
}

/** Обмениваем пользовательскую сессию (Telegram) на админский токен — работает, только если Telegram ID привязан к админу */
export async function ensureAdmin(expectedSession = getUserToken()): Promise<void> {
  if (!expectedSession || expectedSession !== getUserToken()) throw new ApiError(401,'Войдите в свой аккаунт');
  if (boundSession !== expectedSession) { token=null;pending=null;boundSession=expectedSession; }
  if (token) return;
  if (!pending) {
    const job=exchange(expectedSession).finally(()=>{if(pending===job)pending=null;});
    pending=job;
  }
  await pending;
  if (boundSession !== expectedSession || getUserToken() !== expectedSession) throw new ApiError(401,'Сессия изменилась');
}
async function request(method:string,path:string,body:unknown,retry:boolean):Promise<Response> {
  const session=getUserToken();
  await ensureAdmin(session);
  let res:Response;
  try {
    res=await fetch(`/api/v1/admin${path}`,{method,
      headers:{...(body===undefined?{}:{'content-type':'application/json'}),authorization:`Bearer ${token}`},
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(path.startsWith('/support/')?60_000:25_000),cache:'no-store'});
  } catch {throw new ApiError(0,'Нет соединения с сервером');}
  if(getUserToken()!==session||boundSession!==session)throw new ApiError(401,'Сессия изменилась');
  if(res.status===401&&retry){token=null;return request(method,path,body,false);}
  return res;
}
export async function adminApi<T>(method:string,path:string,body?:unknown,retry=true):Promise<T> {
  const res=await request(method,path,body,retry);
  const json:any=await res.json().catch(()=>null);
  if(!res.ok)throw new ApiError(res.status,json?.error?.message??`Ошибка ${res.status}`,json?.error?.code);
  return json as T;
}
export const aget=<T,>(p:string)=>adminApi<T>('GET',p);
export const apost=<T,>(p:string,b?:unknown)=>adminApi<T>('POST',p,b??{});
export const aput=<T,>(p:string,b?:unknown)=>adminApi<T>('PUT',p,b??{});
export const apatch=<T,>(p:string,b?:unknown)=>adminApi<T>('PATCH',p,b??{});
export const adel=<T,>(p:string)=>adminApi<T>('DELETE',p);
export async function aLoadSupportPhoto(id:string):Promise<Blob> {
  const res=await request('GET',`/support/attachments/${encodeURIComponent(id)}`,undefined,true);
  if(!res.ok||!(res.headers.get('content-type')??'').startsWith('image/jpeg'))throw new ApiError(res.status,'Не удалось загрузить фото');
  return res.blob();
}

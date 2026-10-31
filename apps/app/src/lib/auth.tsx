import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, getToken, post, setToken, setUnauthorizedHandler } from './api';
import { initDataRaw, isTelegram, telegramReady } from './tg';

type Status = 'loading' | 'authed' | 'guest' | 'error';
interface AuthCtx {
  status: Status;
  error?: string;
  errorCode?: string;
  login: (token: string) => void;
  logout: () => void;
  retry: () => void;
}
const Ctx = createContext<AuthCtx>({ status: 'loading', login: () => {}, logout: () => {}, retry: () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>();
  const [errorCode, setErrorCode] = useState<string>();
  const qc = useQueryClient();

  const boot = useCallback(async () => {
    setStatus('loading');
    setError(undefined);
    setErrorCode(undefined);
    await telegramReady();
    try {
      if (isTelegram()) {
        // Mini App: всегда подтверждаем личность подписью Telegram
        const r = await post<{ accessToken: string }>('/auth/miniapp', { initData: initDataRaw() });
        setToken(r.accessToken);
        setStatus('authed');
      } else if (getToken()) {
        setStatus('authed');
      } else {
        setStatus('guest');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось войти');
      setErrorCode(e instanceof ApiError ? e.code : undefined);
      setStatus(isTelegram() ? 'error' : 'guest');
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      qc.clear();
      if (isTelegram()) void boot();
      else setStatus('guest');
    });
    void boot();
  }, [boot, qc]);

  const value: AuthCtx = {
    status,
    error,
    errorCode,
    login: (t) => {
      setToken(t);
      qc.clear();
      setStatus('authed');
    },
    logout: () => {
      setToken(null);
      qc.clear();
      setStatus('guest');
    },
    retry: () => void boot(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

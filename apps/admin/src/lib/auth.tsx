import { ROLE_LEVEL, type AdminRole } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, getToken, post, setAuthLostHandler, setToken } from './api';

export interface AdminMe {
  id: string;
  email: string;
  role: AdminRole;
  totpEnabled: boolean;
}
interface Ctx {
  me: AdminMe | null;
  loading: boolean;
  login: (token: string, me: AdminMe, remember?: boolean) => void;
  logout: () => void;
  can: (min: AdminRole) => boolean;
  refresh: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>({ me: null, loading: true, login: () => {}, logout: () => {}, can: () => false, refresh: async () => {} });
export const useAuth = () => useContext(AuthCtx);

let lastRenew = 0;
async function renew() {
  if (!getToken()) return;
  try {
    const r = await post<{ accessToken: string; remember: boolean }>('/auth/refresh');
    if (r.accessToken) setToken(r.accessToken, r.remember);
    lastRenew = Date.now();
  } catch {
    /* сеть — попробуем позже; 401 обработает общий обработчик */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = async () => {
    if (!getToken()) return setLoading(false);
    try {
      setMe(await get<AdminMe>('/me'));
      void renew();
    } catch (e) {
      // выходим только если сервер явно отверг токен; при сбое сети/перезапуске сервера сессию не теряем
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setToken(null);
        setMe(null);
      } else {
        setTimeout(() => void refresh(), 5000);
        return;
      }
    }
    setLoading(false);
  };
  // Продление токена: при открытии, раз в 3 часа и при возвращении на вкладку — пока админка открыта, из неё не выбивает
  useEffect(() => {
    if (!me) return;
    const id = setInterval(() => void renew(), 3 * 3600_000);
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - lastRenew > 30 * 60_000) void renew(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [me]);

  useEffect(() => {
    setAuthLostHandler(() => {
      setToken(null);
      setMe(null);
      qc.clear();
    });
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        me,
        loading,
        login: (t, m, remember) => {
          setToken(t, Boolean(remember));
          lastRenew = Date.now();
          setMe(m);
        },
        logout: () => {
          setToken(null);
          setMe(null);
          qc.clear();
        },
        can: (min) => (me ? ROLE_LEVEL[me.role] >= ROLE_LEVEL[min] : false),
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

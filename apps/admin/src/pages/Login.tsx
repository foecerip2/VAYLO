import { Button, Field, Input } from '@vpn/ui';
import { Box, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiError, post } from '../lib/api';
import { useAuth, type AdminMe } from '../lib/auth';

const REM_KEY = 'admin_remember';
const loadRemember = () => {
  try {
    return localStorage.getItem(REM_KEY) !== '0';
  } catch {
    return true;
  }
};

/** Просим браузер сохранить логин и пароль (Chrome/Edge/Android). Safari и Firefox предложат сами по autocomplete-полям. */
async function savePassword(email: string, password: string) {
  try {
    const W = window as unknown as { PasswordCredential?: new (d: { id: string; password: string; name?: string }) => Credential };
    if (W.PasswordCredential && navigator.credentials?.store) await navigator.credentials.store(new W.PasswordCredential({ id: email, password, name: email }));
  } catch {
    /* браузер отказался — не критично */
  }
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [remember, setRemember] = useState(loadRemember);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!needTotp && (!email.trim() || !password)) return setError('Введите email и пароль');
    setBusy(true);
    try {
      const r = await post<{ needTotp?: boolean; accessToken?: string; admin?: AdminMe }>('/auth/login', { email: email.trim(), password, totp: needTotp ? totp : undefined, remember });
      if (r.needTotp) setNeedTotp(true);
      else if (r.accessToken && r.admin) {
        try {
          localStorage.setItem(REM_KEY, remember ? '1' : '0');
        } catch {
          /* ignore */
        }
        if (remember) await savePassword(email.trim(), password);
        login(r.accessToken, r.admin, remember);
      } else setError('Неожиданный ответ сервера');
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 429 ? 'Слишком много попыток. Подождите минуту.' : err.message) : 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-5 pt-[30vh] [@media(min-width:1024px)_and_(min-aspect-ratio:23/20)_and_(hover:hover)]:justify-end [@media(min-width:1024px)_and_(min-aspect-ratio:23/20)_and_(hover:hover)]:pr-[11vw] [@media(min-width:1024px)_and_(min-aspect-ratio:23/20)_and_(hover:hover)]:pt-5">
      <img src="/orbit-art.png" alt="" aria-hidden="true" className="admin-login-art" />
      <div className="relative z-10 w-full max-w-[400px]" style={{ animation: 'vg-rise .8s cubic-bezier(.2,.8,.2,1) backwards' }}>
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="vg-logo !h-14 !w-14"><i className="!rounded-2xl"><Box className="h-6 w-6" /></i></span>
          <div><div className="text-2xl font-extrabold tracking-[.22em]">VAYLO</div><div className="text-sm text-muted">панель управления</div></div>
        </div>
        <div className="card tilt relative p-7">
          <form onSubmit={submit} noValidate method="post" action="#" className="z space-y-4">
            <div className="text-center">
              <h1 className="text-xl">Вход</h1>
              <p className="mt-1 text-sm text-muted">{needTotp ? 'Введите код из приложения-аутентификатора' : 'Только для сотрудников'}</p>
            </div>
            {!needTotp ? (
              <>
                <Field label="Email"><Input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
                <Field label="Пароль"><Input id="password" name="password" type="password" autoComplete="current-password" autoCapitalize="none" autoCorrect="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                <label className="flex cursor-pointer select-none items-center gap-3 text-sm">
                  <input type="checkbox" className="peer sr-only" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="relative h-6 w-11 shrink-0 rounded-full bg-fg/10 transition peer-checked:bg-gradient-to-r peer-checked:from-primary peer-checked:to-primary-2 peer-focus-visible:ring-2 peer-focus-visible:ring-primary"><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${remember ? 'translate-x-5' : ''}`} /></span>
                  <span><b className="font-semibold">Запомнить меня</b><span className="block text-xs text-muted">Не выходить 30 дней и сохранить пароль в браузере</span></span>
                </label>
              </>
            ) : (
              <Field label="Код 2FA"><Input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} className="text-center text-xl tracking-[.4em]" required autoFocus placeholder="000000" /></Field>
            )}
            {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
            <Button type="submit" full size="lg" loading={busy} icon={<ShieldCheck className="h-5 w-5" />}>{needTotp ? 'Подтвердить' : 'Войти'}</Button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-muted/70">На чужом компьютере снимите «Запомнить меня»</p>
      </div>
    </div>
  );
}

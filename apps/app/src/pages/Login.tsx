import { readPendingGift } from '../lib/gift-links';
import { Button, Card, Logo, Spinner } from '@vpn/ui';
import { ArrowLeft, Send } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfig } from '../lib/queries';

/** Вход на сайт через Telegram-бота: без виджета и без паролей */
export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const cfg = useConfig();
  const [link, setLink] = useState<{ token: string; url: string | null } | null>(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const start = useCallback(async () => {
    setError('');
    setExpired(false);
    try {
      let ref = sp.get('ref');
      try {
        ref = ref ?? sessionStorage.getItem('ref');
      } catch {
        /* ignore */
      }
      setLink(await post('/auth/tglink/start', { ref: ref ?? undefined }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sp]);
  useEffect(() => void start(), [start]);

  useEffect(() => {
    if (!link) return;
    timer.current = setInterval(async () => {
      try {
        const r = await get<{ status: 'pending' | 'ok' | 'expired'; accessToken?: string }>(`/auth/tglink/${link.token}`);
        if (r.status === 'ok' && r.accessToken) {
          clearInterval(timer.current);
          login(r.accessToken);
          nav(readPendingGift() || sp.get('next') === '/gifts?receive=1' ? '/gifts?receive=1' : '/', { replace: true });
        } else if (r.status === 'expired') {
          clearInterval(timer.current);
          setExpired(true);
        }
      } catch {
        /* повторим */
      }
    }, 2000);
    return () => clearInterval(timer.current);
  }, [link, login, nav]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-5">
      <Link to="/" className="flex items-center gap-2 text-sm text-muted"><ArrowLeft className="h-4 w-4" /> На главную</Link>
      <Logo name={cfg.data?.brandName} />
      <Card className="space-y-5 p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Вход через Telegram</h1>
          <p className="mt-2 text-sm text-muted">Нажмите кнопку, откройте бота и нажмите «Запустить» — вы войдёте автоматически.</p>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : !link ? <Spinner className="mx-auto" /> : expired ? (
          <Button full onClick={start}>Ссылка устарела — обновить</Button>
        ) : (
          <>
            {link.url ? <a href={link.url} target="_blank" rel="noreferrer"><Button full size="lg" icon={<Send className="h-5 w-5" />}>Открыть Telegram</Button></a> : <p className="text-sm text-danger">Бот не настроен (BOT_USERNAME).</p>}
            {link.url && <div className="mx-auto hidden w-fit rounded-2xl bg-white p-3 md:block"><QRCodeSVG value={link.url} size={168} /></div>}
            <div className="flex items-center justify-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" /> Ждём подтверждения в боте…</div>
          </>
        )}
      </Card>
    </div>
  );
}

import { Button, Card, CopyField, Logo } from '@vpn/ui';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CLIENTS } from '../lib/clients';

/** Публичная страница: открывает VPN-приложение по глубокой ссылке (Telegram не пускает кастомные схемы в кнопки) */
export default function ImportPage() {
  const [sp] = useSearchParams();
  const client = CLIENTS.find((c) => c.id === sp.get('client'));
  const url = sp.get('url') ?? '';
  const valid = client && /^https?:\/\//.test(url);
  const deeplink = valid ? client!.deeplink(url) : '';

  useEffect(() => {
    if (!deeplink) return;
    const t = setTimeout(() => (window.location.href = deeplink), 350);
    return () => clearTimeout(t);
  }, [deeplink]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo />
      {valid ? (
        <Card className="w-full space-y-4 p-6">
          <h1 className="text-xl font-bold">Открываем {client!.name}…</h1>
          <p className="text-sm text-muted">Подписка добавится в приложение автоматически. Если ничего не произошло — нажмите кнопку или скопируйте ссылку.</p>
          <a href={deeplink}><Button full size="lg">Открыть {client!.name}</Button></a>
          <CopyField value={url} />
        </Card>
      ) : (
        <Card className="w-full p-6"><h1 className="text-lg font-bold">Некорректная ссылка</h1><p className="mt-2 text-sm text-muted">Откройте приложение и скопируйте ссылку подписки вручную.</p></Card>
      )}
    </div>
  );
}

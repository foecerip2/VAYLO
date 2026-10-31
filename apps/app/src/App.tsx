import { usePublishedMiniAppDesign } from './lib/design';
import GiftGuest from './pages/GiftGuest';
import { readPendingGift } from './lib/gift-links';
import { Button, Card, Logo, ToastProvider } from '@vpn/ui';
import { LaunchWait } from './components/LaunchWait';
import { ClosedGuard, RegistrationClosed } from './components/Closure';
import { useLaunchTransition } from './lib/launch';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { setGateHandler } from './lib/api';
import { useAuth } from './lib/auth';
import { useConfig, useMe } from './lib/queries';
import { isTelegram } from './lib/tg';
import { runNetProbe } from './lib/netprobe';
import { post } from './lib/api';
import GateScreen from './pages/GateScreen';
import Home from './pages/Home';

const Addons = lazy(() => import('./pages/Addons'));
const Connect = lazy(() => import('./pages/Connect'));
const Quests = lazy(() => import('./pages/Quests'));
const Devices = lazy(() => import('./pages/Devices'));
const Wheel = lazy(() => import('./pages/Wheel'));
const Referrals = lazy(() => import('./pages/Referrals'));
const ReferralTree = lazy(() => import('./pages/ReferralTree'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Locations = lazy(() => import('./pages/Locations'));
const Plans = lazy(() => import('./pages/Plans'));
const Profile = lazy(() => import('./pages/Profile'));
const Support = lazy(() => import('./pages/Support'));
const SupportThread = lazy(() => import('./pages/SupportThread'));
const Gifts = lazy(() => import('./pages/Gifts'));
const Help = lazy(() => import('./pages/Help'));
const ImportPage = lazy(() => import('./pages/Import'));
const PaymentStatus = lazy(() => import('./pages/PaymentStatus'));
const PaymentReturnGuest = lazy(() => import('./pages/PaymentStatus').then((m) => ({ default: m.PaymentReturnGuest })));
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));

const Splash = LaunchWait;

function TelegramError() {
  const { error, errorCode, retry } = useAuth();
  if (errorCode === 'registration_closed') return <RegistrationClosed />;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo />
      <Card className="max-w-sm space-y-4 p-6">
        <h1 className="text-lg font-bold">Не удалось войти</h1>
        <p className="text-sm text-muted">{error ?? 'Ошибка авторизации'}</p>
        <Button full onClick={retry}>Повторить</Button>
      </Card>
    </div>
  );
}

/** Акцентный цвет из настроек админки + обработка «нужна подписка на канал» */
function useBranding(authed: boolean) {
  const cfg = useConfig();
  const qc = useQueryClient();
  usePublishedMiniAppDesign();
  useEffect(() => { if (cfg.data?.brandName) document.title = cfg.data.brandName + ' · VPN'; }, [cfg.data?.brandName]);
  // фоновый замер доступности из сети пользователя: через 8 секунд после входа, не чаще раза в 6 часов
  useEffect(() => {
    if (!authed) return;
    const t = setTimeout(() => void runNetProbe(), 8000);
    return () => clearTimeout(t);
  }, [authed]);
  // продуктовая аналитика: одно событие «открыл Mini App» на сессию (сервер игнорирует, если модуль выключен); без контента и ПД
  useEffect(() => {
    if (!authed) return;
    try {
      if (sessionStorage.getItem('ev-open')) return;
      sessionStorage.setItem('ev-open', '1');
    } catch { /* без хранилища — просто одно событие */ }
    const id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    void post('/events', { eventId: id, name: 'miniapp_open' }).catch(() => undefined);
  }, [authed]);
  useEffect(() => {
    if (authed) setGateHandler(() => void qc.invalidateQueries({ queryKey: ['me'] }));
  }, [authed, qc]);
}

function Gated({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const cfg = useConfig();
  const g = me.data?.gate;
  if (g?.required && !g.ok) return <GateScreen gate={g} brand={cfg.data?.brandName ?? 'VPN'} />;
  return <>{children}</>;
}

export default function App() {
  const { status } = useAuth();
  useLaunchTransition(status);
  useBranding(status === 'authed');
  if (status === 'loading') return <Splash />;
  if (status === 'error' && isTelegram()) return <TelegramError />;

  return (
    <ToastProvider>
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/import" element={<ImportPage />} />
          <Route path="/login" element={status === 'authed' ? <Navigate to={readPendingGift() ? "/gifts?receive=1" : "/"} replace /> : <Login />} />
          {status !== 'authed' ? (
            <>
              {/* возврат с оплаты во внешнем браузере без сессии — не показываем лендинг */}
              <Route path="/payment/:id" element={<PaymentReturnGuest />} />
              <Route path="/gifts" element={<GiftGuest />} />
              <Route path="*" element={<Landing />} />
            </>
          ) : (
            <Route element={<Gated><Layout /></Gated>}>
              <Route index element={<Home />} />
              <Route path="help" element={<Help />} />
              <Route path="gifts" element={<ClosedGuard><Gifts /></ClosedGuard>} />
              <Route path="connect" element={<Connect />} />
              <Route path="locations" element={<Locations />} />
              <Route path="plans" element={<ClosedGuard><Plans /></ClosedGuard>} />
              <Route path="wallet" element={<ClosedGuard><Wallet /></ClosedGuard>} />
              <Route path="addons" element={<ClosedGuard><Addons /></ClosedGuard>} />
              <Route path="quests" element={<ClosedGuard><Quests /></ClosedGuard>} />
              <Route path="wheel" element={<ClosedGuard><Wheel /></ClosedGuard>} />
              <Route path="devices" element={<Devices />} />
              <Route path="referrals" element={<Referrals />} />
              <Route path="referrals/tree" element={<ReferralTree />} />
              <Route path="admin/*" element={<AdminApp />} />
              <Route path="profile" element={<Profile />} />
              <Route path="support" element={<Support />} />
              <Route path="support/:id" element={<SupportThread />} />
              <Route path="payment/:id" element={<PaymentStatus />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          )}
        </Routes>
      </Suspense>
    </ToastProvider>
  );
}

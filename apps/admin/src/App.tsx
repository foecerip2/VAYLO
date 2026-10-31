import TrialCleanup from './pages/TrialCleanup';
import Gifts from './pages/Gifts';
import { ToastProvider } from '@vpn/ui';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Sk, SkRows } from './components/kit';
import { useAuth } from './lib/auth';
import Audit from './pages/Audit';
import Broadcasts from './pages/Broadcasts';
import Catalog from './pages/Catalog';
import Monitoring from './pages/Monitoring';
import Quests from './pages/Quests';
import Support from './pages/Support';
import Activity from './pages/Activity';
import Wheel from './pages/Wheel';
import BotWelcome from './pages/BotWelcome';
import Withdrawals from './pages/Withdrawals';
import Referrals from './pages/Referrals';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Nodes from './pages/Nodes';
import Payments from './pages/Payments';
import Plans from './pages/Plans';
import Promo from './pages/Promo';
import Campaigns from './pages/Campaigns';
import Network from './pages/Network';
import StatusServers from './pages/StatusServers';
import Growth from './pages/Growth';
import Contests from './pages/Contests';
import Ads from './pages/Ads';
import ClosurePage from './pages/Closure';
import NetworkIntelligence from './pages/NetworkIntelligence';
import Analytics from './pages/Analytics';
import NodeRecommendations from './pages/NodeRecommendations';
import Settings from './pages/Settings';
import Users from './pages/Users';
import LteActivity from './pages/LteActivity';

export default function App() {
  const { me, loading, can } = useAuth();
  return (
    <ToastProvider>
      {loading ? (
        <div className="flex min-h-screen"><div className="hidden w-64 shrink-0 space-y-3 border-r border-fg/10 p-4 lg:block"><Sk className="h-8 w-32" /><SkRows n={7} /></div><div className="flex-1 space-y-4 p-4 sm:p-6"><Sk className="h-10 w-48" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Sk className="h-24" /><Sk className="h-24" /><Sk className="h-24" /><Sk className="h-24" /></div><Sk className="h-64" /></div></div>
      ) : !me ? (
        <Login />
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            {can('admin') && <Route path="trial-cleanup" element={<TrialCleanup />} />}
            <Route path="users" element={<Users />} />
            <Route path="lte-activity" element={<LteActivity />} />
            <Route path="payments" element={<Payments />} />
            <Route path="gifts" element={<Gifts />} />
            <Route path="plans" element={<Plans />} />
            <Route path="promo" element={<Promo />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="broadcasts" element={<Broadcasts />} />
            <Route path="nodes" element={<Nodes />} />
            <Route path="contests" element={<Contests />} />
            <Route path="closure" element={<ClosurePage />} />
            <Route path="ads" element={<Ads />} />
            <Route path="growth" element={<Growth />} />
            <Route path="status-servers" element={<StatusServers />} />
            <Route path="network-intelligence" element={<NetworkIntelligence />} />
            <Route path="node-recommendations" element={<NodeRecommendations />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="network" element={<Network />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="withdrawals" element={<Withdrawals />} />
            {can('admin') && <Route path="bot" element={<BotWelcome />} />}
            <Route path="quests" element={<Quests />} />
            <Route path="support" element={<Support />} />
            <Route path="activity" element={<Activity />} />
            <Route path="wheel" element={<Wheel />} />
            <Route path="catalog" element={<Catalog />} />
            {can('admin') && <Route path="audit" element={<Audit />} />}
            {can('admin') && <Route path="settings" element={<Settings />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </ToastProvider>
  );
}

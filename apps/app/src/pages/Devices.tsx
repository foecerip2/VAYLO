import { Button, Card, EmptyState, ErrorState, ProgressBar, Skeleton, useToast } from '@vpn/ui';
import type { DevicesDTO } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Laptop, Monitor, PackagePlus, Plus, Smartphone, Trash2, Tv } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { errorText, post } from '../lib/api';
import { useConfig, useDevices } from '../lib/queries';
import { confirmDialog, haptic } from '../lib/tg';

const iconFor = (platform: string | null) => {
  const p = (platform ?? '').toLowerCase();
  if (/android|ios|iphone|ipad/.test(p)) return <Smartphone className="h-6 w-6" />;
  if (/tv/.test(p)) return <Tv className="h-6 w-6" />;
  if (/win|linux/.test(p)) return <Monitor className="h-6 w-6" />;
  if (/mac|darwin/.test(p)) return <Laptop className="h-6 w-6" />;
  return <Smartphone className="h-6 w-6" />;
};
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 60 * 24) return `${Math.round(m / 60)} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

export default function Devices() {
  const d = useDevices();
  const cfg = useConfig();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, path: string, body?: unknown) {
    setBusy(key);
    try {
      const r = await post<DevicesDTO>(path, body);
      qc.setQueryData(['devices'], r);
      haptic('success');
    } catch (e) {
      haptic('error');
      toast(errorText(e), 'error');
      void qc.invalidateQueries({ queryKey: ['devices'] });
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: string, name: string) {
    if (!(await confirmDialog(`Удалить «${name}»? Устройство освободит место и потеряет доступ, пока его не подключат снова.`))) return;
    await run(id, '/devices/delete', { id });
  }
  async function removeAll() {
    if (!(await confirmDialog('Удалить все устройства? Придётся подключить их заново.'))) return;
    await run('all', '/devices/delete-all');
  }

  const x = d.data;
  const unlimited = x ? x.limit === 0 : false;
  const full = x ? !unlimited && x.used >= x.limit : false;
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Устройства" subtitle="Подключённые к подписке устройства. Удалите лишнее, чтобы освободить место." />
      {d.isLoading ? (
        <Skeleton className="h-40 w-full !rounded-card" />
      ) : d.isError ? (
        <ErrorState message={errorText(d.error)} onRetry={() => d.refetch()} />
      ) : !x?.active && !x?.devices.length ? (
        <Card><EmptyState icon={<Smartphone className="h-6 w-6" />} title="Нет активной подписки" text="Оформите подписку, и здесь появятся ваши устройства." action={<Link to="/plans"><Button>Выбрать тариф</Button></Link>} /></Card>
      ) : x ? (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex items-baseline justify-between">
              <div className="font-display text-lg font-extrabold">{unlimited ? `${x.used} устр.` : `${x.used} из ${x.limit}`}</div>
              <div className="text-sm text-muted">{unlimited ? 'без ограничений' : full ? 'мест нет' : `свободно ${x.limit - x.used}`}</div>
            </div>
            {!unlimited && <ProgressBar value={Math.min(1, x.used / Math.max(1, x.limit))} tone={full ? 'warning' : 'primary'} />}
            {x.extraDevices > 0 && <div className="text-xs text-muted">В лимит входят докупленные устройства: {x.extraDevices}</div>}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link to="/connect"><Button full variant="secondary" icon={<Plus className="h-4 w-4" />}>Подключить</Button></Link>
              {cfg.data?.addonsEnabled !== false && <Link to="/addons"><Button full icon={<PackagePlus className="h-4 w-4" />}>Докупить</Button></Link>}
            </div>
            {full && <p className="text-xs text-muted">Чтобы подключить новое устройство, удалите ненужное или докупите место.</p>}
          </Card>

          {x.devices.length === 0 ? (
            <Card className="p-5 text-center text-sm text-muted">Пока нет подключённых устройств. Добавьте подписку в VPN-приложение, и оно появится здесь.</Card>
          ) : (
            <div className="space-y-3">
              {x.devices.map((v) => (
                <Card key={v.id} className="flex items-center gap-3 p-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">{iconFor(v.platform)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 break-words font-semibold leading-tight">{v.name}</div>
                    <div className="mt-0.5 text-xs text-muted">Был в сети: {ago(v.lastSeenAt)}</div>
                  </div>
                  <Button size="sm" variant="ghost" aria-label="Удалить устройство" loading={busy === v.id} disabled={busy !== null} onClick={() => remove(v.id, v.name)} icon={<Trash2 className="h-5 w-5 text-danger" />} />
                </Card>
              ))}
              {x.devices.length > 1 && <Button full variant="ghost" loading={busy === 'all'} disabled={busy !== null} onClick={removeAll}><span className="text-danger">Удалить все устройства</span></Button>}
            </div>
          )}
          <p className="px-1 text-xs text-muted">Устройство добавляется само, когда вы впервые подключаетесь в VPN-приложении по своей ссылке подписки. Не делитесь ссылкой, иначе чужие устройства займут места.</p>
        </>
      ) : null}
    </div>
  );
}

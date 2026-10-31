import { Suspense, lazy, useEffect, useState } from 'react';
import { is3DEnabled } from './Backdrop3D.lazyflag';

const Backdrop3D = lazy(() => import('./Backdrop3D'));

/** 3D-фон грузится отдельным чанком уже после интерфейса; выключатель — в меню профиля */
export function Lazy3D({ mode = 'ambient' }: { mode?: 'ambient' | 'hero' }) {
  const [on, setOn] = useState(is3DEnabled());
  useEffect(() => {
    const f = () => setOn(is3DEnabled());
    window.addEventListener('admin-3d', f);
    return () => window.removeEventListener('admin-3d', f);
  }, []);
  if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return <Suspense fallback={null}><Backdrop3D mode={mode} /></Suspense>;
}

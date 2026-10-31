import type { MiniAppDesignId } from '@vpn/shared';
import { useEffect, useState } from 'react';
import { useMotionVisibility } from '../lib/useMotionVisibility';

/** Original chrome artwork, with independent light, orbit and particle layers. */
export function OrbitArtwork({ design = 'orbit-signature' }: { design?: MiniAppDesignId }) {
  const motion=useMotionVisibility<HTMLDivElement>();
  const [failed,setFailed]=useState(false);
  useEffect(() => setFailed(false), [design]);
  if (design === 'arctic-glass') return <div {...motion} className="arctic-art" aria-hidden="true">
    <div className="arctic-wave arctic-wave-one"/><div className="arctic-wave arctic-wave-two"/>
    <div className="arctic-globe">{!failed ? <img src="/arctic-globe.png" alt="" decoding="async" onError={() => setFailed(true)} /> : <svg viewBox="0 0 200 200"><defs><radialGradient id="ice"><stop stopColor="#e6f6ff"/><stop offset="1" stopColor="#6daceb"/></radialGradient></defs><circle cx="100" cy="100" r="80" fill="url(#ice)" stroke="#fff" strokeWidth="2"/><g fill="none" stroke="#fff" strokeOpacity=".8"><ellipse cx="100" cy="100" rx="38" ry="80"/><ellipse cx="100" cy="100" rx="65" ry="80"/><ellipse cx="100" cy="100" rx="80" ry="32"/><path d="M20 100h160M30 60h140M30 140h140"/></g></svg>}</div>
    <span className="arctic-satellite arctic-satellite-one"/><span className="arctic-satellite arctic-satellite-two"/>
  </div>;
  return <div {...motion} className="orbit-art live-orbit" aria-hidden="true">
    <div className="live-orbit-aura" />
    <div className="live-orbit-image">
      {!failed ? <img src="/orbit-art.png" alt="" decoding="async" onError={()=>setFailed(true)} /> : <span className="live-orbit-fallback"><i/><i/><i/></span>}
    </div>
    <div className="live-orbit-light" />
    <div className="live-orbit-path live-orbit-path-one"><i /></div>
    <div className="live-orbit-path live-orbit-path-two"><i /></div>
    <div className="live-orbit-sparks">{Array.from({length:7},(_,i)=><i key={i} />)}</div>
    <div className="live-orbit-flare" />
  </div>;
}

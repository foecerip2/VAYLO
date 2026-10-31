import { useCallback, useEffect, useState } from 'react';

/** Pause decorative loops offscreen and while Telegram is in the background. */
export function useMotionVisibility<T extends HTMLElement>() {
  const [element,setElement] = useState<T|null>(null);
  const ref=useCallback((node:T|null)=>setElement(node),[]);
  const [running,setRunning] = useState(false);
  useEffect(()=>{
    if(!element)return;
    let visible = true;
    const update=()=>setRunning(visible && !document.hidden);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries=>{
      visible=entries[0]?.isIntersecting ?? false;update();
    },{threshold:0.05});
    observer?.observe(element);document.addEventListener('visibilitychange',update);update();
    return()=>{observer?.disconnect();document.removeEventListener('visibilitychange',update);};
  },[element]);
  return {ref,'data-motion-running':running?'true':'false'} as const;
}

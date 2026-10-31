import { useMotionVisibility } from '../lib/useMotionVisibility';
export function Announcement({text}:{text:string}) {
  const motion=useMotionVisibility<HTMLDivElement>();
  return <div {...motion} className="orbit-announcement mb-4 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-center text-sm font-medium text-fg"><span>{text}</span></div>;
}

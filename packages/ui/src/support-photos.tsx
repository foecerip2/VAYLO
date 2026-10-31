import { ImagePlus, Loader2, Maximize2, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Sheet, cn } from './components';

export interface SupportDraftPhoto { id: string; image: string; name: string }
export interface SupportPhoto { id: string; name: string; mime: string; size: number; width: number; height: number }
const MAX_PHOTOS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
async function preparePhoto(file: File): Promise<SupportDraftPhoto> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Выберите фото размером до 20 МБ');
  if (!/^(image\/(jpeg|png|webp|heic|heif))$/.test(file.type) && !(file.type === '' && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))) throw new Error('Подойдут фото JPG, PNG или WebP');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Фото не открылось. Сохраните его как JPG или PNG.')); });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('Фото слишком большое. Выберите снимок меньшего размера.');
    const scale = Math.min(1, 2048 / image.naturalWidth, 4096 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось подготовить фото. Откройте приложение заново.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [.92, .82, .7, .58]) {
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_BYTES) break;
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error('Не удалось уменьшить фото. Выберите другой снимок.');
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Не удалось прочитать фото')); reader.readAsDataURL(blob!); });
    canvas.width = 1; canvas.height = 1;
    return { id: crypto.randomUUID(), image: data, name: (file.name || 'Фото').slice(0, 160) };
  } finally { URL.revokeObjectURL(url); }
}

export function SupportPhotoPicker({ value, onChange, disabled, onBusyChange }: {
  value: SupportDraftPhoto[]; onChange: (photos: SupportDraftPhoto[]) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);
  async function choose(files: File[]) {
    if (!files.length || busy || disabled) return;
    if (value.length + files.length > MAX_PHOTOS) { setError('К одному сообщению можно приложить до трёх фото'); return; }
    const version = ++generation.current; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const photos: SupportDraftPhoto[] = [];
      for (const file of files) photos.push(await preparePhoto(file));
      if (generation.current === version) onChange([...value, ...photos]);
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : 'Не удалось подготовить фото'); }
    finally { if (generation.current === version) { setBusy(false); onBusyChange?.(false); } }
  }
  return <div className="min-w-0 space-y-2" aria-label="Фото к сообщению">
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="sr-only" aria-label="Выбрать фотографии" disabled={disabled || busy || value.length >= MAX_PHOTOS} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void choose(files); }} />
    <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="secondary" className="!min-h-11" disabled={disabled || busy || value.length >= MAX_PHOTOS} onClick={() => input.current?.click()} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}>{busy ? 'Подготавливаем фото…' : 'Прикрепить фото'}</Button><span className="text-xs text-muted">{value.length}/3 · фото или скриншот</span></div>
    {value.length > 0 && <div className="flex flex-wrap gap-2">{value.map((p, i) => <div key={p.id} className="relative w-24 overflow-hidden rounded-xl border border-border bg-surface-2"><img src={p.image} alt={`Выбранное фото ${i + 1}`} className="h-24 w-full object-cover" /><button type="button" disabled={disabled || busy} onClick={() => { setError(''); onChange(value.filter(x => x.id !== p.id)); }} aria-label={`Убрать фото ${i + 1}`} className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-bl-xl bg-black/70 text-white disabled:opacity-50"><X className="h-4 w-4" /></button></div>)}</div>}
    {error && <p role="alert" className="text-xs leading-relaxed text-danger">{error}</p>}
  </div>;
}

function PrivateSupportPhoto({ photo, load, compact }: { photo: SupportPhoto; load: (id: string) => Promise<Blob>; compact: boolean }) {
  const height = compact ? 'h-36' : 'h-48';
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0); const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true; let objectUrl = '';
    setFailed(false); setUrl('');
    void load(photo.id).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id, load, attempt]);
  return <>
    {failed ? <button type="button" className={cn('flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 p-3 text-xs text-muted', height)} onClick={() => setAttempt(x => x + 1)}><RotateCw className="h-4 w-4 shrink-0" />Фото не загрузилось. Повторить</button> : !url ? <div className={cn('grid place-items-center rounded-xl bg-surface-2', height)} aria-label="Загрузка фото"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div> : <button type="button" aria-label={`Увеличить фото: ${photo.name}`} className={cn('group relative block w-full min-w-0 overflow-hidden rounded-xl border border-border/60 bg-surface-2', height)} onClick={() => setOpen(true)}><img src={url} alt={photo.name} width={photo.width} height={photo.height} className="h-full w-full object-contain" decoding="async" /><span className="absolute bottom-2 right-2 rounded-lg bg-black/65 p-1.5 text-white"><Maximize2 className="h-4 w-4" /></span></button>}
    <Sheet open={open && !!url} onClose={() => setOpen(false)} title="Фото в обращении" wide><div className="space-y-3"><img src={url || undefined} alt={photo.name} className="mx-auto max-h-[70dvh] max-w-full rounded-xl object-contain" /><p className="break-words text-xs text-muted">{photo.name} · {photo.width} × {photo.height}</p><a href={url} download={photo.name} className="inline-flex min-h-11 items-center rounded-xl bg-primary/10 px-4 text-sm font-semibold text-primary">Скачать фото</a></div></Sheet>
  </>;
}
export function SupportPhotos({ photos = [], load, className }: { photos?: SupportPhoto[]; load: (id: string) => Promise<Blob>; className?: string }) {
  if (!photos.length) return null;
  return <div className={cn('grid w-full min-w-0 gap-2', photos.length > 1 && 'grid-cols-2', className)} aria-label="Прикреплённые фото">{photos.map(photo => <PrivateSupportPhoto key={photo.id} photo={photo} load={load} compact={photos.length > 1} />)}</div>;
}

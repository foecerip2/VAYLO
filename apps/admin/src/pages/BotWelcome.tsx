import { Badge, Button, Card, Field, Skeleton, Textarea, useToast } from '@vpn/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageTitle, Section } from '../components/kit';
import { ApiError, del, get, post, put } from '../lib/api';

interface State { settings: { description: string; short_description: string; start_text: string }; imageUrl: string | null }
interface SyncRes { ok: boolean; error?: string }

/** Уменьшаем картинку в браузере (до 1280 px по ширине, JPEG) — меньше трафика и гарантированно проходит лимит */
async function toJpegBase64(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88).split(',')[1]!;
}

const Counter = ({ v, max }: { v: string; max: number }) => <span className={`text-xs ${v.length > max * 0.95 ? 'text-warning' : 'text-muted'}`}>{v.length}/{max}</span>;

function Bubble({ text, image, buttons }: { text: string; image: string | null; buttons?: string[] }) {
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl bg-[#182533] text-[14px] leading-snug text-white shadow-lg">
      {image && <img src={image} alt="" className="max-h-52 w-full object-cover" />}
      <div className="whitespace-pre-wrap px-3.5 py-3">{text || <span className="text-white/40">Текст не задан</span>}</div>
      {buttons && <div className="grid gap-1 px-2 pb-2">{buttons.map((b) => <div key={b} className="rounded-lg bg-white/10 py-1.5 text-center text-[13px] text-sky-200">{b}</div>)}</div>}
    </div>
  );
}

export default function BotWelcome() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['bot-welcome'], queryFn: () => get<State>('/bot-welcome') });
  const [f, setF] = useState<State['settings'] | null>(null);
  useEffect(() => { if (q.data && !f) setF(q.data.settings); }, [q.data, f]);
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
  const dirty = Boolean(f && q.data && JSON.stringify(f) !== JSON.stringify(q.data.settings));

  const save = useMutation({
    mutationFn: (sync: boolean) => put<State & { synced: SyncRes | null }>('/bot-welcome', { ...f, sync }),
    onSuccess: (r) => {
      qc.setQueryData(['bot-welcome'], { settings: r.settings, imageUrl: r.imageUrl });
      setF(r.settings);
      if (r.synced) toast(r.synced.ok ? 'Сохранено и применено в Telegram' : `Сохранено, но Telegram отклонил: ${r.synced.error}`, r.synced.ok ? 'success' : 'error');
      else toast('Сохранено', 'success');
    },
    onError,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => post<State>('/bot-welcome/image', { data: await toJpegBase64(file) }),
    onSuccess: (r) => { qc.setQueryData(['bot-welcome'], (o: State | undefined) => ({ settings: o?.settings ?? r.settings, imageUrl: r.imageUrl })); toast('Картинка загружена', 'success'); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => del<State>('/bot-welcome/image'),
    onSuccess: (r) => { qc.setQueryData(['bot-welcome'], (o: State | undefined) => ({ settings: o?.settings ?? r.settings, imageUrl: null })); toast('Картинка удалена', 'success'); },
    onError,
  });

  if (!f || q.isLoading) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  const startPreview = f.start_text.replace(/\{brand\}/g, 'VAYLO').replace(/\{name\}/g, 'Сергей');
  return (
    <div className="animate-fade-up space-y-5">
      <PageTitle title="Приветствие бота" subtitle="Что видит человек, когда открывает бота: описание до запуска и сообщение с картинкой после /start." actions={<div className="flex gap-2"><Button variant="secondary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(false)}>Сохранить</Button><Button icon={<Send className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate(true)}>Сохранить и применить в Telegram</Button></div>} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Сообщение после /start" description="Картинка + текст + кнопки меню. Можно использовать {brand} (название) и {name} (имя человека). Пустой текст — стандартное меню без картинки.">
          <div className="space-y-4">
            <Field label="Картинка">
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
                <Button variant="secondary" icon={<ImagePlus className="h-4 w-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>{q.data?.imageUrl ? 'Заменить' : 'Загрузить'}</Button>
                {q.data?.imageUrl && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>Убрать</Button>}
                <span className="text-xs text-muted">JPG, PNG или WebP. Лучше широкая, примерно 1280×720.</span>
              </div>
            </Field>
            <Field label="Текст приветствия"><Textarea rows={8} maxLength={900} value={f.start_text} onChange={(e) => setF({ ...f, start_text: e.target.value })} /></Field>
            <div className="-mt-2 text-right"><Counter v={f.start_text} max={900} /></div>
            <p className="text-xs text-muted">Если у сообщения есть картинка, Telegram показывает под ней не более 1024 символов, лишнее обрежется — не пишите длинно.</p>
          </div>
        </Section>
        <Section title="Так это увидит человек" description="Приблизительный вид в Telegram после /start">
          <Bubble text={startPreview} image={q.data?.imageUrl ?? null} buttons={['🚀 Открыть приложение', '🔑 Подключиться  ·  💳 Тарифы']} />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Описание «Что умеет этот бот?»" description="Показывается в пустом чате с ботом до нажатия «Запустить бота». Применяется кнопкой «Сохранить и применить в Telegram».">
          <div className="space-y-3">
            <Textarea rows={11} maxLength={512} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <div className="text-right"><Counter v={f.description} max={512} /></div>
            <Field label="Короткое описание (в профиле бота и при пересылке)"><Textarea rows={2} maxLength={120} value={f.short_description} onChange={(e) => setF({ ...f, short_description: e.target.value })} /></Field>
            <div className="text-right"><Counter v={f.short_description} max={120} /></div>
          </div>
        </Section>
        <Section title="Как будет выглядеть до запуска" description="Описание бота в пустом чате">
          <Bubble text={`Что умеет этот бот?\n\n${f.description}`} image={null} />
          <Card className="mt-4 space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold">Картинка над описанием <Badge tone="warning">только через BotFather</Badge></div>
            <p className="text-muted">Telegram не позволяет менять эту картинку программно. Один раз откройте @BotFather → /mybots → ваш бот → Edit Bot → Edit Description Picture и отправьте картинку (рекомендуемый размер 640×360). Текст описания при этом меняется отсюда.</p>
          </Card>
        </Section>
      </div>
    </div>
  );
}

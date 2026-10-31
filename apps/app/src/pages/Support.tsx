import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Skeleton, Textarea, cn, useToast, SupportPhotoPicker, type SupportDraftPhoto } from '@vpn/ui';
import { SUPPORT_PRIORITY, SUPPORT_STATUS_LABEL, type SupportPriority } from '@vpn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronRight, LifeBuoy, MessageCircle, PenLine, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ApiError, errorText, post } from '../lib/api';
import { useConfig, useSupport } from '../lib/queries';
import { haptic, openExternal } from '../lib/tg';

const QUICK = ['Не подключается VPN', 'Как установить приложение?', 'Медленно работает интернет', 'Как продлить подписку?'];
const TONE = { normal: 'success', important: 'warning', urgent: 'danger' } as const;
export const STATUS_LABEL = SUPPORT_STATUS_LABEL;

export function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function Support() {
  const q = useSupport();
  const cfg = useConfig();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [search] = useSearchParams();
  const diagnostic = (search.get('diagnostic') ?? '').slice(0, 600);
  const [form, setForm] = useState(!!diagnostic);
  const [prio, setPrio] = useState<SupportPriority>('normal');
  const [subject, setSubject] = useState(diagnostic ? 'Помощь с подключением' : '');
  const [body, setBody] = useState(diagnostic ? diagnostic + '\n\nПодробности: ' : '');
  const [photos, setPhotos] = useState<SupportDraftPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function startChat(first?: string) {
    setBusy(first ?? 'chat'); haptic('light');
    try {
      const { id } = await post<{ id: string }>('/support/chat');
      if (first) await post(`/support/tickets/${id}/messages`, { text: first });
      void qc.invalidateQueries({ queryKey: ['support'] });
      nav(`/support/${id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally { setBusy(null); }
  }
  async function create() {
    setBusy('ticket');
    try {
      const { id } = await post<{ id: string }>('/support/tickets', { subject, body, priority: prio, photos: photos.map(({image,name})=>({image,name})) });
      haptic('success');
      void qc.invalidateQueries({ queryKey: ['support'] });
      nav(`/support/${id}`);
    } catch (e) {
      haptic('error');
      toast(e instanceof ApiError ? e.message : 'Не удалось создать обращение', 'error');
    } finally { setBusy(null); }
  }

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-40 !rounded-[28px]" /><Skeleton className="h-24" /></div>;
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.enabled) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Поддержка" />
        <Card><EmptyState icon={<LifeBuoy className="h-6 w-6" />} title="Напишите нам" text="Чат поддержки временно недоступен." action={cfg.data?.supportUrl ? <Button onClick={() => openExternal(cfg.data!.supportUrl)}>Написать в поддержку</Button> : undefined} /></Card>
      </div>
    );
  }
  const muted = d.mutedUntil && new Date(d.mutedUntil) > new Date();
  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Поддержка" subtitle="Подскажем, как подключиться и что делать, если что-то не работает" />

      <div className="hero-bg relative overflow-hidden rounded-[28px] p-5 text-white shadow-glow">
        <div className="blob pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm text-white/90">
            <span className={cn('h-2 w-2 rounded-full', d.ai ? 'bg-emerald-300 shadow-[0_0_10px_#6ee7b7]' : 'bg-amber-300')} />
            {d.ai ? 'ИИ-помощник онлайн · отвечает сразу' : 'Отвечаем в течение дня'}
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold leading-tight">{d.ai ? 'Спросите помощника' : 'Задайте вопрос'}</div>
          <p className="mt-1 text-sm text-white/80">{d.ai ? 'Коротко и по делу. Если не справится — позовёт человека.' : 'Опишите проблему — ответит оператор, мы пришлём уведомление в бота.'}</p>
          <Button className="mt-4" style={{ background: '#fff', color: '#6d28d9', boxShadow: 'none' }} full loading={busy === 'chat'} disabled={Boolean(muted)} icon={d.ai ? <Sparkles className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />} onClick={() => startChat()}>
            {d.ai ? 'Открыть чат с помощником' : 'Написать в поддержку'}
          </Button>
        </div>
      </div>

      {muted && <div className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">Чат поддержки временно закрыт из-за нарушений правил общения. Попробуйте позже.</div>}

      {d.ai && !muted && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Частые вопросы</div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((t) => (
              <button key={t} disabled={busy !== null} onClick={() => startChat(t)} className="rounded-full border border-white/10 bg-white/[.04] px-3.5 py-2 text-sm font-medium transition hover:border-primary/50 active:scale-95 disabled:opacity-50">{t}</button>
            ))}
          </div>
        </div>
      )}

      <Card className="p-4">
        <button className="flex w-full items-center gap-3 text-left" disabled={busy !== null || preparing} onClick={() => setForm((v) => !v)} aria-expanded={form}>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary"><PenLine className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><div className="font-semibold">Создать обращение</div><div className="text-sm text-muted">Для сложных случаев — ответит человек</div></div>
          <ChevronRight className={cn('h-5 w-5 text-muted transition', form && 'rotate-90')} />
        </button>
        {form && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium">Насколько это важно?</div>
              <div className="grid gap-2 md:grid-cols-3">
                {(Object.keys(SUPPORT_PRIORITY) as SupportPriority[]).map((k) => (
                  <button key={k} onClick={() => setPrio(k)} className={cn('rounded-2xl border p-3 text-left transition', prio === k ? 'border-primary bg-primary/10 shadow-glow' : 'border-white/[.08] bg-white/[.02]')}>
                    <div className="font-bold">{SUPPORT_PRIORITY[k].emoji} {SUPPORT_PRIORITY[k].label}</div>
                    <div className="mt-0.5 text-xs text-muted">{SUPPORT_PRIORITY[k].hint}</div>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Тема"><Input value={subject} maxLength={80} onChange={(e) => setSubject(e.target.value)} placeholder="Например: не подключается на iPhone" /></Field>
            <Field label="Что случилось?" hint="Укажите устройство, приложение и что именно не работает"><Textarea value={body} maxLength={1500} onChange={(e) => setBody(e.target.value)} placeholder="Опишите проблему как можно подробнее" /></Field>
            <SupportPhotoPicker value={photos} onChange={setPhotos} onBusyChange={setPreparing} disabled={busy !== null || Boolean(muted)} />
            <Button full loading={busy === 'ticket'} disabled={(!body.trim() && !photos.length) || preparing || Boolean(muted)} onClick={create}>Отправить обращение</Button>
          </div>
        )}
      </Card>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Мои обращения</div>
        {!d.tickets.length ? (
          <Card><EmptyState icon={<Bot className="h-6 w-6" />} title="Пока пусто" text="Здесь появятся ваши диалоги и обращения." /></Card>
        ) : (
          <div className="space-y-2.5">
            {d.tickets.map((t) => (
              <button key={t.id} onClick={() => nav(`/support/${t.id}`)} className="card flex w-full min-w-0 items-center gap-3 p-4 text-left transition active:scale-[.99]">
                <div className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', t.mode === 'ai' ? 'bg-primary/15 text-primary' : 'bg-white/5')}>
                  {t.mode === 'ai' ? <Sparkles className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
                  {t.unread && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-danger ring-2 ring-[#0a0710]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t.kind === 'chat' ? 'Чат с помощником' : t.subject || `Обращение №${t.number}`}</div>
                  <div className="text-xs text-muted">{t.kind === 'ticket' ? `№${t.number} · ` : ''}{ago(t.updatedAt)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {t.kind === 'ticket' && <Badge tone={TONE[t.priority]}>{SUPPORT_PRIORITY[t.priority].label}</Badge>}
                  <span className="text-xs text-muted">{t.mode === 'ai' && t.status !== 'closed' ? 'Помощник' : STATUS_LABEL[t.status]}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

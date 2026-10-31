import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { OPERATOR_LABEL, osOf, resolveOperator, type Operator } from './netprobe.js';
import { recommendForUser } from './nodeRanking.js';
import { statusView } from './serverStatus.js';

export type Tone = 'ok' | 'warn' | 'bad' | 'unknown';
export interface DiagStep { id: string; tone: Tone; title: string; hint: string }
export interface Diagnosis { operator: Operator | null; operatorLabel: string | null; os: 'ios' | 'android' | 'other'; steps: DiagStep[]; recommendedLabel: string | null; verdict: 'service' | 'operator' | 'subscription' | 'unknown'; ticketDraft: string }

/** «Не работает»: автоматическая проверка со стороны сервиса. Ни ключей, ни ссылок подписки в ответе нет. */
export async function diagnose(user: UserRow, ip: string, ua: string): Promise<Diagnosis> {
  const steps: DiagStep[] = [];
  const os = osOf(ua);
  let verdict: Diagnosis['verdict'] = 'unknown';

  const [sub] = await sql()`select expires_at, is_trial from subscriptions where user_id = ${user.id}`;
  if (!sub) steps.push({ id: 'sub', tone: 'bad', title: 'Подписки нет', hint: 'Возьмите пробный период или выберите тариф.' });
  else if ((sub.expires_at as Date).getTime() <= Date.now()) { steps.push({ id: 'sub', tone: 'bad', title: 'Подписка закончилась', hint: 'Продлите тариф, и доступ вернётся.' }); verdict = 'subscription'; }
  else steps.push({ id: 'sub', tone: 'ok', title: 'Подписка активна', hint: '' });

  const st = await statusView().catch(() => null);
  if (!st || st.overall === 'unknown') steps.push({ id: 'servers', tone: 'unknown', title: 'Состояние серверов неизвестно', hint: 'Данных мониторинга сейчас нет.' });
  else if (st.overall === 'ok') steps.push({ id: 'servers', tone: 'ok', title: 'Серверы работают', hint: '' });
  else {
    const down = st.groups.flatMap((g) => g.items).filter((i) => i.status === 'down').map((i) => i.title);
    steps.push({ id: 'servers', tone: st.overall === 'down' ? 'bad' : 'warn', title: 'Часть серверов недоступна', hint: down.length ? `Недоступны: ${down.join(', ')}. Выберите другую локацию.` : 'Выберите другую локацию.' });
    if (verdict === 'unknown') verdict = 'service';
  }

  let operator: Operator | null = null;
  try { operator = (await resolveOperator(ip)).operator; } catch { /* нет данных об операторе */ }
  if (operator === 'other') operator = null;
  if (config().NETWORK_INTELLIGENCE_ENABLED && operator) {
    const [inc] = await sql()`select state, target from network_incidents where operator = ${operator} and state in ('suspected','confirmed') order by started_at desc limit 1`;
    if (inc?.state === 'confirmed') { steps.push({ id: 'operator', tone: 'bad', title: `Перебои у оператора ${OPERATOR_LABEL[operator]}`, hint: `Подтверждена проблема с «${inc.target}». Попробуйте другую локацию или Wi-Fi.` }); if (verdict === 'unknown') verdict = 'operator'; }
    else if (inc) steps.push({ id: 'operator', tone: 'warn', title: `Возможны перебои у оператора ${OPERATOR_LABEL[operator]}`, hint: 'Проблема пока не подтверждена. Попробуйте другую локацию.' });
    else steps.push({ id: 'operator', tone: 'unknown', title: 'У вашего оператора проблем не видно', hint: 'Это не гарантия: проверок из вашей сети может быть мало.' });
  }

  let recommendedLabel: string | null = null;
  try {
    const rec = await recommendForUser(user, ip);
    if (rec.enabled && rec.recommendedNodeId) {
      const r = rec.ranked.find((x) => x.nodeId === rec.recommendedNodeId);
      if (r) { recommendedLabel = r.label; steps.push({ id: 'node', tone: 'ok', title: `Сейчас лучше всего: ${r.label}`, hint: r.reasons.join(', ') }); }
    }
  } catch { /* рекомендации необязательны */ }

  steps.push({ id: 'client', tone: 'unknown', title: 'Обновите подписку в приложении-клиенте', hint: 'Потяните список серверов вниз или нажмите «Обновить подписку», затем выберите другую локацию.' });

  const ticketDraft = [`Диагностика (автоматически):`, `ОС: ${os}`, `Оператор: ${operator ? OPERATOR_LABEL[operator] : 'не определён'}`, ...steps.map((s) => `${s.tone === 'ok' ? '✓' : s.tone === 'bad' ? '✗' : s.tone === 'warn' ? '!' : '?'} ${s.title}`)].join('\n');
  return { operator, operatorLabel: operator ? OPERATOR_LABEL[operator] : null, os, steps, recommendedLabel, verdict, ticketDraft };
}

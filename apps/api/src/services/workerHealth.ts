import { redisConnection } from './broadcast.js';

const KEY = 'worker:heartbeat';
let r: ReturnType<typeof redisConnection> | null = null;
const redis = () => (r ??= redisConnection());

/** Воркер отмечается раз в минуту; API по метке понимает, жив ли воркер (cron-задачи, рассылки, инциденты). */
export async function workerBeat(): Promise<void> { await redis().set(KEY, String(Date.now()), 'EX', 600); }

export async function workerHealth(): Promise<{ alive: boolean; lastBeatAt: string | null; ageSec: number | null }> {
  try {
    const v = await redis().get(KEY);
    if (!v) return { alive: false, lastBeatAt: null, ageSec: null };
    const age = Math.round((Date.now() - Number(v)) / 1000);
    return { alive: age < 180, lastBeatAt: new Date(Number(v)).toISOString(), ageSec: age };
  } catch { return { alive: false, lastBeatAt: null, ageSec: null }; }
}

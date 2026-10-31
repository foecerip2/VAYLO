import { createHmac } from 'node:crypto';

export function makeInitData(user: { id: number; first_name?: string; username?: string }, opts: { startParam?: string; authDate?: number; token?: string } = {}) {
  const params = new URLSearchParams();
  params.set('auth_date', String(opts.authDate ?? Math.floor(Date.now() / 1000)));
  params.set('query_id', 'AAH-test');
  params.set('user', JSON.stringify(user));
  if (opts.startParam) params.set('start_param', opts.startParam);
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(opts.token ?? process.env.BOT_TOKEN!).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

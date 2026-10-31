import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contract = require('@remnawave/backend-contract');

type Handler = (req: IncomingMessage, body: any, url: URL) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;

async function startServer(handler: Handler): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = undefined;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* ignore */
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const r = await handler(req, body, url);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json ?? {}));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: (e as Error).message }));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

/** Мок Remnawave: проверяет запросы схемами из ОФИЦИАЛЬНОГО пакета @remnawave/backend-contract */
export async function startRemnawaveMock(token = 'rw-test-token') {
  const users = new Map<number, any>();
  let nextId = 1;
  const squadUuid = randomUUID();
  const devices = new Map<number, any[]>();
  const nodeUuid = randomUUID();
  const state = { nodes: [{ uuid: nodeUuid, id: 1, name: 'NL-1', address: '5.5.5.5', port: 2222, countryCode: 'NL', isConnected: true, isDisabled: false, usersOnline: 7 }] as any[], hosts: [{ uuid: randomUUID(), remark: 'NL', address: '5.5.5.5' }, { uuid: randomUUID(), remark: 'other', address: '9.9.9.9' }] as any[], restarts: 0, devices, users, calls: [] as string[], fail: false, squadUuid, squads: [{ uuid: squadUuid, name: 'Default-Squad' }] as { uuid: string; name: string }[] };

  const toResponse = (u: any) => ({
    ...u,
    userTraffic: { usedTrafficBytes: u.usedTrafficBytes ?? 0, lifetimeUsedTrafficBytes: 0, onlineAt: null, firstConnectedAt: null, lastConnectedNodeUuid: null },
  });
  const okUser = (u: any) => ({ json: { response: toResponse(u) } });

  const { server, url } = await startServer(async (req, body, u) => {
    const path = u.pathname;
    state.calls.push(`${req.method} ${path}`);
    if (state.fail) return { status: 500, json: { message: 'boom' } };
    if (req.headers.authorization !== `Bearer ${token}`) return { status: 401, json: { message: 'unauthorized' } };
    if (req.headers['x-forwarded-proto'] !== 'https') return { status: 403, json: { message: 'proxy headers required' } };

    if (req.method === 'POST' && path === '/api/users/') {
      const parsed = contract.CreateUserCommand.RequestBodySchema.safeParse(body);
      if (!parsed.success) return { status: 400, json: { statusCode: 400, message: 'Validation failed', errors: parsed.error.issues } };
      if ([...users.values()].some((x) => x.username === body.username)) return { status: 400, json: { message: 'User username already exists', errorCode: 'A019' } };
      const id = nextId++;
      const shortUuid = body.shortUuid ?? 'sh' + randomUUID().replace(/-/g, '').slice(0, 14);
      const user = {
        id, uuid: randomUUID(), shortUuid, username: body.username, status: body.status ?? 'ACTIVE', trafficLimitBytes: body.trafficLimitBytes ?? 0,
        expireAt: new Date(body.expireAt).toISOString(), hwidDeviceLimit: body.hwidDeviceLimit ?? 0, telegramId: body.telegramId ?? null,
        activeInternalSquads: body.activeInternalSquads ?? [], subscriptionUrl: `https://sub.example.test/api/sub/${shortUuid}`, usedTrafficBytes: 0,
      };
      users.set(id, user);
      return okUser(user);
    }
    if (req.method === 'PATCH' && path === '/api/users/') {
      const parsed = contract.UpdateUserCommand.RequestBodySchema.safeParse(body);
      if (!parsed.success) return { status: 400, json: { statusCode: 400, message: 'Validation failed', errors: parsed.error.issues } };
      const user = users.get(body.id);
      if (!user) return { status: 404, json: { message: 'User not found' } };
      Object.assign(user, { ...body, expireAt: body.expireAt ? new Date(body.expireAt).toISOString() : user.expireAt });
      return okUser(user);
    }
    let m = path.match(/^\/api\/users\/by-username\/(.+)$/);
    if (m && req.method === 'GET') {
      const user = [...users.values()].find((x) => x.username === decodeURIComponent(m![1]!));
      return user ? okUser(user) : { status: 404, json: { message: 'User not found' } };
    }
    m = path.match(/^\/api\/users\/by-short-uuid\/(.+)$/);
    if (m && req.method === 'GET') {
      const user = [...users.values()].find(x => x.shortUuid === decodeURIComponent(m![1]!));
      return user ? okUser(user) : { status: 404, json: { message: 'User not found' } };
    }
    m = path.match(/^\/api\/users\/(\d+)\/actions\/(revoke|enable|disable|reset-traffic)$/);
    if (m && req.method === 'POST') {
      const user = users.get(Number(m[1]));
      if (!user) return { status: 404, json: { message: 'User not found' } };
      if (m[2] === 'revoke') {
        user.shortUuid = 'rv' + randomUUID().replace(/-/g, '').slice(0, 14);
        user.subscriptionUrl = `https://sub.example.test/api/sub/${user.shortUuid}`;
      }
      if (m[2] === 'enable') user.status = 'ACTIVE';
      if (m[2] === 'disable') user.status = 'DISABLED';
      if (m[2] === 'reset-traffic') user.usedTrafficBytes = 0;
      return okUser(user);
    }
    m = path.match(/^\/api\/users\/(\d+)$/);
    if (m && req.method === 'GET') {
      const user = users.get(Number(m[1]));
      return user ? okUser(user) : { status: 404, json: { message: 'User not found' } };
    }
    if (m && req.method === 'DELETE') {
      const deleted = users.delete(Number(m[1]));
      devices.delete(Number(m[1]));
      return deleted ? { json: { response: { ok: true } } } : { status: 404, json: { message: 'User not found' } };
    }
    m = path.match(/^\/api\/hwid\/devices\/(\d+)$/);
    if (m && req.method === 'GET') { const l = devices.get(Number(m[1])) ?? []; return { json: { response: { total: l.length, devices: l } } }; }
    if (req.method === 'POST' && path === '/api/hwid/devices/delete') {
      const l = (devices.get(body.userId) ?? []).filter((d: any) => d.hwid !== body.hwid); devices.set(body.userId, l);
      return { json: { response: { total: l.length, devices: l } } };
    }
    if (req.method === 'POST' && path === '/api/hwid/devices/delete-all') { devices.set(body.userId, []); return { json: { response: { total: 0, devices: [] } } }; }
    if (req.method === 'GET' && path === '/api/nodes/') return { json: { response: state.nodes } };
    if (req.method === 'PATCH' && path === '/api/nodes') {
      const n = state.nodes.find((x: any) => x.uuid === body.uuid); if (!n) return { status: 404, json: { message: 'no node' } };
      Object.assign(n, { ...(body.address ? { address: body.address } : {}) }); return { json: { response: n } };
    }
    if (req.method === 'POST' && /^\/api\/nodes\/[^/]+\/actions\/restart$/.test(path)) { state.restarts++; return { json: { response: { ok: true } } }; }
    if (req.method === 'GET' && path === '/api/hosts') return { json: { response: state.hosts } };
    if (req.method === 'PATCH' && path === '/api/hosts') {
      const h = state.hosts.find((x: any) => x.uuid === body.uuid); if (!h) return { status: 404, json: { message: 'no host' } };
      h.address = body.address; return { json: { response: h } };
    }
    if (req.method === 'GET' && path === '/api/internal-squads/') {
      return { json: { response: { total: state.squads.length, internalSquads: state.squads } } };
    }
    return { status: 404, json: { message: 'not found ' + path } };
  });
  return { server, url, token, state };
}

export async function startYookassaMock(shopId = 'shop1', secret = 'sk_test') {
  const payments = new Map<string, any>();
  const refunds = new Map<string, { id: string; status: string; payment_id: string }>();
  const state = { payments, refunds, statusOverride: null as null | string, calls: [] as { method: string; path: string; body: any; headers: IncomingMessage['headers'] }[] };
  const { server, url } = await startServer((req, body, u) => {
    state.calls.push({ method: req.method!, path: u.pathname, body, headers: req.headers });
    const auth = 'Basic ' + Buffer.from(`${shopId}:${secret}`).toString('base64');
    if (req.headers.authorization !== auth) return { status: 401, json: { type: 'error', code: 'invalid_credentials', description: 'Basic auth required' } };
    if (req.method === 'POST' && u.pathname === '/payments') {
      if (!req.headers['idempotence-key']) return { status: 400, json: { description: 'Idempotence-Key required' } };
      const key = String(req.headers['idempotence-key']);
      const existing = [...payments.values()].find((p) => p._key === key);
      if (existing) return { json: existing };
      const id = 'yk-' + randomUUID();
      const p = { id, _key: key, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, receipt: body.receipt, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.test/pay/${id}` } };
      payments.set(id, p);
      return { json: p };
    }
    const rf = u.pathname.match(/^\/refunds\/(.+)$/);
    if (req.method === 'GET' && rf) {
      const r = state.refunds.get(rf[1]!);
      return r ? { json: r } : { status: 404, json: { description: 'not found' } };
    }
    const m = u.pathname.match(/^\/payments\/(.+)$/);
    if (req.method === 'GET' && m) {
      const p = payments.get(m[1]!);
      if (!p) return { status: 404, json: { description: 'not found' } };
      return { json: { ...p, status: state.statusOverride ?? p.status } };
    }
    if (req.method === 'GET' && u.pathname === '/payments') return { json: { type: 'list', items: [...payments.values()].filter((p) => (state.statusOverride ?? p.status) === (u.searchParams.get('status') ?? (state.statusOverride ?? p.status))).map((p) => ({ ...p, status: state.statusOverride ?? p.status })) } };
    return { status: 404 };
  });
  return { server, url, state, shopId, secret };
}

export async function startPlategaMock(merchant = 'merchant-1', secret = 'pl-secret') {
  const txs = new Map<string, any>();
  const state = { txs, calls: [] as { method: string; path: string; body: any }[] };
  const { server, url } = await startServer((req, body, u) => {
    state.calls.push({ method: req.method!, path: u.pathname, body });
    if (req.headers['x-merchantid'] !== merchant || req.headers['x-secret'] !== secret) return { status: 401, json: { message: 'unauthorized' } };
    if (req.method === 'POST' && u.pathname === '/transaction/process') {
      if (!body?.paymentMethod || !body?.paymentDetails?.amount || body.paymentDetails.currency !== 'RUB') return { status: 400, json: { message: 'bad body' } };
      const id = randomUUID();
      const tx = { transactionId: id, redirect: `https://pay.platega.test/${id}`, status: 'PENDING', body };
      txs.set(id, tx);
      return { json: { transactionId: id, redirect: tx.redirect, status: 'PENDING', expiresIn: '00:15:00' } };
    }
    const m = u.pathname.match(/^\/transaction\/(.+)$/);
    if (req.method === 'GET' && m) {
      const tx = txs.get(m[1]!);
      return tx ? { json: { id: tx.transactionId, status: tx.status, paymentMethod: 'SBP' } } : { status: 404, json: { message: 'not found' } };
    }
    if (req.method === 'GET' && u.pathname === '/rates/payment_method_rate') return { json: { rate: 90.5, updatedAt: new Date().toISOString() } };
    return { status: 404 };
  });
  return { server, url, state, merchant, secret };
}

export async function startRollypayMock(apiKey = 'rpk_test_key') {
  const pays = new Map<string, any>();
  const nonces = new Set<string>();
  const state = { pays, calls: [] as { method: string; path: string; body: any; headers: Record<string, any> }[], down: false };
  const { server, url } = await startServer((req, body, u) => {
    state.calls.push({ method: req.method!, path: u.pathname, body, headers: req.headers as any });
    if (state.down) return { status: 500, json: { error: 'down' } };
    const nonce = String(req.headers['x-nonce'] ?? '');
    if (req.headers['x-api-key'] !== apiKey) return { status: 401, json: { error: 'invalid api key' } };
    if (!nonce || nonces.has(nonce)) return { status: 401, json: { error: 'nonce reused' } };
    nonces.add(nonce);
    if (req.method === 'POST' && u.pathname === '/payments') {
      if (!/^\d+\.\d{2}$/.test(String(body?.amount)) || !body?.order_id || body.payment_currency !== 'RUB') return { status: 400, json: { error: 'bad body' } };
      const id = randomUUID();
      const p = { payment_id: id, order_id: body.order_id, status: 'created', amount: body.amount, pay_url: `https://pay.rollypay.test/${id}`, body };
      pays.set(id, p);
      return { json: { payment_id: id, pay_url: p.pay_url, status: 'created' } };
    }
    const m = u.pathname.match(/^\/payments\/(.+)$/);
    if (req.method === 'GET' && m) {
      const p = pays.get(m[1]!);
      return p ? { json: { data: { payment_id: p.payment_id, order_id: p.order_id, status: p.status, amount: p.amount } } } : { status: 404, json: { error: 'not found' } };
    }
    if (req.method === 'GET' && u.pathname === '/payments') return { json: { data: [...pays.values()].map((p) => ({ payment_id: p.payment_id, order_id: p.order_id, status: p.status, amount: p.amount, payment_currency: 'RUB' })) } };
    return { status: 404 };
  });
  return { server, url, state, apiKey };
}

export async function startTelegramMock() {
  const state = { messages: [] as { chat_id: number; text: string; reply_markup?: any }[], blocked: new Set<number>(), members: new Map<string, Set<number>>(), down: false };
  const { server, url } = await startServer((req, body, u) => {
    if (state.down) return { status: 500, json: { ok: false, description: 'down' } };
    if (u.pathname.endsWith('/getMe')) return { json: { ok: true, result: { id: 1, username: 'test_vpn_bot' } } };
    if (u.pathname.endsWith('/getChatMember')) {
      const set = state.members.get(String(body.chat_id));
      if (!set) return { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } };
      return { json: { ok: true, result: { status: set.has(body.user_id) ? 'member' : 'left' } } };
    }
    if (u.pathname.endsWith('/sendMessage')) {
      if (state.blocked.has(body.chat_id)) return { status: 403, json: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } };
      state.messages.push(body);
      return { json: { ok: true, result: { message_id: state.messages.length } } };
    }
    return { json: { ok: true, result: true } };
  });
  return { server, url, state };
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
const run = async (cmd: string, args: string[], opts: any = {}) => String((await execFileP(cmd, args, { encoding: 'utf8', ...opts })).stdout);
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const c = require('@remnawave/backend-contract');
const SCRIPTS = resolve(__dirname, '../../../scripts');
const TOKEN = 'tok-install';

let server: Server;
let base = '';
const profiles: any[] = [];
const squads: any[] = [];
const nodes: any[] = [];
const hosts: any[] = [];
const errors: string[] = [];

function parse(schema: any, body: any, what: string) {
  const r = schema.safeParse(body);
  if (!r.success) { errors.push(`${what}: ${r.error.message}`); return false; }
  return true;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'unauthorized' });
      const url = (req.url ?? '').split('?')[0].replace(/\/$/, '');
      let body: any = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { return send(400, {}); }
      const m = req.method;
      if (url === '/api/config-profiles' && m === 'GET') return send(200, { response: { total: profiles.length, configProfiles: profiles } });
      if (url === '/api/config-profiles' && m === 'POST') {
        if (!parse(c.CreateConfigProfileCommand.RequestBodySchema, body, 'profile')) return send(400, {});
        const ib = body.config.inbounds.map((i: any) => ({ uuid: randomUUID(), profileUuid: '', tag: i.tag, type: i.protocol, network: 'tcp', security: 'reality', port: i.port, rawInbound: i }));
        const p = { uuid: randomUUID(), name: body.name, inbounds: ib, config: body.config };
        ib.forEach((i: any) => (i.profileUuid = p.uuid));
        profiles.push(p);
        return send(200, { response: p });
      }
      const pm = url.match(/^\/api\/config-profiles\/([\w-]+)$/);
      if (pm && m === 'GET') { const p = profiles.find((x) => x.uuid === pm[1]); return p ? send(200, { response: p }) : send(404, {}); }
      if (url === '/api/internal-squads' && m === 'GET') return send(200, { response: { total: squads.length, internalSquads: squads } });
      if (url === '/api/internal-squads' && m === 'POST') {
        if (!parse(c.CreateInternalSquadCommand.RequestBodySchema, body, 'squad')) return send(400, {});
        const s = { uuid: randomUUID(), name: body.name, inbounds: body.inbounds.map((u: string) => ({ uuid: u })) };
        squads.push(s); return send(200, { response: s });
      }
      if (url === '/api/internal-squads' && m === 'PATCH') {
        if (!parse(c.UpdateInternalSquadCommand.RequestBodySchema, body, 'squad-update')) return send(400, {});
        const sq = squads.find((x) => x.uuid === body.uuid); if (!sq) return send(404, {});
        sq.inbounds = body.inbounds.map((u: string) => ({ uuid: u })); return send(200, { response: sq });
      }
      if (url === '/api/nodes' && m === 'GET') return send(200, { response: nodes });
      if (url === '/api/nodes' && m === 'POST') {
        if (!parse(c.CreateNodeCommand.RequestBodySchema, body, 'node')) return send(400, {});
        const n = { uuid: randomUUID(), ...body }; nodes.push(n); return send(200, { response: n });
      }
      if (url === '/api/keygen' && m === 'GET') return send(200, { response: { secretKey: 'c2VjcmV0LWtleS1mb3ItdGVzdA==' } });
      if (url === '/api/hosts' && m === 'GET') return send(200, { response: hosts });
      if (url === '/api/hosts' && m === 'POST') {
        if (!parse(c.CreateHostCommand.RequestBodySchema, body, 'host')) return send(400, {});
        const h = { uuid: randomUUID(), ...body }; hosts.push(h); return send(200, { response: h });
      }
      return send(404, { message: `no route ${m} ${url}` });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('установщики Remnawave', () => {
  it('install-remnawave: профиль Reality + сквад создаются и повторный запуск идемпотентен', async () => {
    const src = readFileSync(join(SCRIPTS, 'install-remnawave.sh'), 'utf8');
    const apiFns = src.slice(src.indexOf('api() {'), src.indexOf('# ----', src.indexOf('http_body()')));
    const provFns = src.slice(src.indexOf('x25519_keys()'), src.indexOf('if [ -n "${API_TOKEN:-$ACCESS}" ]'));
    const harness = `
set -Eeuo pipefail
info(){ :; }; ok(){ :; }; warn(){ echo "WARN: $*" >&2; }
rand_hex(){ openssl rand -hex "$1"; }
LOCAL_API='${base}'
${apiFns}
ACCESS=""; API_TOKEN="${TOKEN}"
${provFns}
provision_vpn "$API_TOKEN"
echo "SQUAD=$SQUAD_UUID INBOUND=$INBOUND_UUID PROFILE=$PROFILE_UUID"
`;
    const out1 = await run('bash', ['-c', harness]);
    const out2 = await run('bash', ['-c', harness]);
    expect(errors).toEqual([]);
    expect(profiles).toHaveLength(1);
    expect(squads).toHaveLength(1);
    const cfg = profiles[0].config.inbounds[0];
    expect(cfg.port).toBe(443);
    const rs = cfg.streamSettings.realitySettings;
    expect(rs.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rs.shortIds[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(out1).toContain(`SQUAD=${squads[0].uuid}`);
    expect(out2).toContain(`SQUAD=${squads[0].uuid}`);
  });

  it('install-node: создаёт ноду и хост, пишет compose; повторно не дублирует', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rn-'));
    const args = [join(SCRIPTS, 'install-node.sh'), '--panel', base, '--token', TOKEN, '--name', 'Finland', '--country', 'fi', '--address', '203.0.113.5', '--dir', dir, '--yes'];
    const env = { ...process.env, NODE_SKIP_INSTALL: '1' };
    await run('bash', args, { env });
    await run('bash', args, { env });
    expect(errors).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].countryCode).toBe('FI');
    expect(nodes[0].configProfile.activeInbounds).toEqual([profiles[0].inbounds[0].uuid]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].address).toBe('203.0.113.5');
    const compose = readFileSync(join(dir, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('network_mode: host');
    expect(compose).toContain('SECRET_KEY=c2VjcmV0LWtleS1mb3ItdGVzdA==');
  });

  it('install-node: неверный токен — понятная ошибка', async () => {
    let msg = '';
    try {
      await run('bash', [join(SCRIPTS, 'install-node.sh'), '--panel', base, '--token', 'bad', '--address', '1.2.3.4', '--yes'], { env: { ...process.env, NODE_SKIP_INSTALL: '1' } });
    } catch (e: any) { msg = String(e.stderr); }
    expect(msg).toContain('отклонила токен');
  });

  it('install-cdn: профиль XHTTP, нода, сквад и хост; nginx-конфиг; повтор идемпотентен', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdn-'));
    const args = [join(SCRIPTS, 'install-cdn.sh'), '--panel', base, '--token', TOKEN, '--origin', 'cdn.example.com', '--cdn-domain', 'yacdn.example.com', '--name', 'Yandex-CDN', '--country', 'ru', '--address', '203.0.113.9', '--obfs', '--dir', join(dir, 'node'), '--yes'];
    const env = { ...process.env, CDN_SKIP_INSTALL: '1', CDN_NGINX_DIR: join(dir, 'nginx'), CDN_WEB_DIR: join(dir, 'www') };
    await run('bash', args, { env });
    await run('bash', args, { env });
    expect(errors).toEqual([]);
    const prof = profiles.find((p) => p.name === 'VAYLO-CDN');
    expect(prof).toBeTruthy();
    expect(profiles.filter((p) => p.name === 'VAYLO-CDN')).toHaveLength(1);
    const ib = prof.config.inbounds[0];
    expect(ib.listen).toBe('127.0.0.1');
    expect(ib.streamSettings.network).toBe('xhttp');
    expect(ib.streamSettings.xhttpSettings.xPaddingObfsMode).toBe(true);
    const node = nodes.find((n) => n.address === '203.0.113.9');
    expect(node.countryCode).toBe('RU');
    const sq = squads.find((x) => x.name === 'VAYLO');
    expect(sq.inbounds.map((i: any) => i.uuid)).toContain(prof.inbounds[0].uuid);
    expect(sq.inbounds).toHaveLength(2);
    const host = hosts.find((h) => h.address === 'yacdn.example.com');
    expect(hosts.filter((h) => h.address === 'yacdn.example.com')).toHaveLength(1);
    expect(host.port).toBe(443);
    expect(host.path).toBe('/api/getFile');
    expect(host.securityLayer).toBe('TLS');
    expect(host.sni).toBe('yacdn.example.com');
    expect(host.xhttpExtraParams.xPaddingKey).toBe('hash');
    const conf = readFileSync(join(dir, 'nginx/sites-available/cdnsite'), 'utf8');
    expect(conf).toContain('location /api/getFile {');
    expect(conf).toContain('proxy_request_buffering off;');
    expect(conf).toContain('proxy_pass http://127.0.0.1:2053;');
  });
});

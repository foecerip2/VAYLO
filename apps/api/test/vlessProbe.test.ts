import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
// @ts-expect-error — обычный .mjs без типов
import { buildConfig, extractLinks, parseVless } from '../../../scripts/vless-probe/lib.mjs';

const run = promisify(execFile);
const PROBE = new URL('../../../scripts/vless-probe/probe.mjs', import.meta.url).pathname;
const UUID = '11111111-2222-4333-8444-555555555555';

it('разбирает ссылки подписки (base64 и текст)', () => {
  const l = `vless://${UUID}@node.example.com:443?type=tcp&security=reality&pbk=PUB&sid=ab&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#%D0%9B%D0%B0%D1%82%D0%B2%D0%B8%D1%8F`;
  expect(extractLinks(l + '\nvmess://x')).toEqual([l]);
  expect(extractLinks(Buffer.from(l + '\n').toString('base64'))).toEqual([l]);
  const v = parseVless(l);
  expect(v).toMatchObject({ remark: 'Латвия', id: UUID, address: 'node.example.com', port: 443, security: 'reality', pbk: 'PUB', flow: 'xtls-rprx-vision' });
});

it('строит конфиг xray для Reality, TLS+WS и XHTTP', () => {
  const r = buildConfig(parseVless(`vless://${UUID}@h:443?type=tcp&security=reality&pbk=PUB&sid=ab&sni=s.com&flow=xtls-rprx-vision#a`), 1080);
  expect(r.inbounds[0]).toMatchObject({ protocol: 'socks', port: 1080, listen: '127.0.0.1' });
  expect(r.outbounds[0].streamSettings).toMatchObject({ network: 'tcp', security: 'reality', realitySettings: { publicKey: 'PUB', shortId: 'ab', serverName: 's.com' } });
  expect(r.outbounds[0].settings.vnext[0].users[0]).toMatchObject({ id: UUID, flow: 'xtls-rprx-vision', encryption: 'none' });
  const ws = buildConfig(parseVless(`vless://${UUID}@h:443?type=ws&security=tls&sni=s.com&host=s.com&path=%2Fws#b`), 1080);
  expect(ws.outbounds[0].streamSettings).toMatchObject({ network: 'ws', security: 'tls', wsSettings: { path: '/ws', headers: { Host: 's.com' } } });
  const x = buildConfig(parseVless(`vless://${UUID}@h:443?type=xhttp&security=tls&sni=s.com&path=%2Fapi%2FgetFile&mode=packet-up&extra=${encodeURIComponent('{"xPaddingBytes":"100-1000"}')}#c`), 1080);
  expect(x.outbounds[0].streamSettings.xhttpSettings).toMatchObject({ path: '/api/getFile', mode: 'packet-up', extra: { xPaddingBytes: '100-1000' } });
  expect(() => buildConfig(parseVless(`vless://${UUID}@h:443?security=reality#d`), 1080)).toThrow(/publicKey/);
});

// Подставной «xray»: слушает SOCKS5 на порту из конфига и пересылает любой CONNECT на локальный HTTP-сервер.
// Ссылка с UUID, начинающимся на «bad», имитирует конфиг, с которым xray не стартует.
let http: Server; let httpPort = 0; let subServer: Server; let subPort = 0; let fake = ''; let apiServer: Server; let apiPort = 0; const reports: any[] = [];
beforeAll(async () => {
  http = createServer((_q, s) => { s.statusCode = 204; s.end(); });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r)); httpPort = (http.address() as net.AddressInfo).port;
  const good = `vless://${UUID}@good.example:443?type=tcp&security=reality&pbk=PUB&sid=ab&sni=s.com#Хорошая`;
  const bad = `vless://bad00000-2222-4333-8444-555555555555@bad.example:443?type=tcp&security=reality&pbk=PUB&sid=ab&sni=s.com#Сломанная`;
  subServer = createServer((_q, s) => s.end(Buffer.from([good, bad].join('\n')).toString('base64')));
  await new Promise<void>((r) => subServer.listen(0, '127.0.0.1', r)); subPort = (subServer.address() as net.AddressInfo).port;
  apiServer = createServer((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { reports.push({ key: q.headers['x-internal-key'], body: JSON.parse(b) }); s.setHeader('content-type', 'application/json'); s.end('{"ok":true}'); }); });
  await new Promise<void>((r) => apiServer.listen(0, '127.0.0.1', r)); apiPort = (apiServer.address() as net.AddressInfo).port;
  const dir = mkdtempSync(join(tmpdir(), 'fakexray-')); fake = join(dir, 'xray');
  writeFileSync(fake, `#!/usr/bin/env node
const fs=require('fs'),net=require('net');
const cfg=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('-c')+1],'utf8'));
if(cfg.outbounds[0].settings.vnext[0].users[0].id.startsWith('bad')){console.error('failed to build outbound');process.exit(1);}
net.createServer((c)=>{let st=0;c.on('data',(d)=>{if(st===0){c.write(Buffer.from([5,0]));st=1;}else if(st===1){st=2;const up=net.connect(${httpPort},'127.0.0.1',()=>{c.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));c.pipe(up);up.pipe(c);});up.on('error',()=>c.destroy());}});c.on('error',()=>{});}).listen(cfg.inbounds[0].port,'127.0.0.1');
`);
  chmodSync(fake, 0o755);
});
afterAll(() => { for (const s of [http, subServer, apiServer]) s.close(); });

it('проба: поднимает xray для каждой ссылки, различает рабочую и сломанную, шлёт отчёт с ключом', async () => {
  let out = '';
  try {
    out = String((await run('node', [PROBE, '--sub', `http://127.0.0.1:${subPort}/`, '--api', `http://127.0.0.1:${apiPort}`, '--key', 'k123', '--name', 'phone-beeline', '--operator', 'beeline', '--xray', fake, '--test-url', 'http://probe.test/generate_204'])).stdout);
  } catch (e: any) { out = String(e.stdout); expect(e.code).toBe(3); } // код 3 — есть неработающие
  expect(out).toMatch(/OK\s+Хорошая/);
  expect(out).toMatch(/FAIL\s+Сломанная.*xray не запустился/);
  expect(reports).toHaveLength(1);
  expect(reports[0].key).toBe('k123');
  expect(reports[0].body).toMatchObject({ name: 'phone-beeline', operator: 'beeline' });
  const byName = Object.fromEntries(reports[0].body.results.map((r: any) => [r.target, r]));
  expect(byName['Хорошая']).toMatchObject({ kind: 'vless', ok: true });
  expect(byName['Сломанная']).toMatchObject({ kind: 'vless', ok: false });
}, 40000);

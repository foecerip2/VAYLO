#!/usr/bin/env node
// Проба по ключу VLESS: берёт ссылки из подписки тестового пользователя, для каждой поднимает xray,
// ходит через неё в интернет и отправляет результат в VAYLO. Запускать там, откуда нужно проверять доступность
// (VPS, телефон с SIM-картой оператора). Зависимостей нет, нужен Node 18+ и бинарник xray.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { buildConfig, extractLinks, parseVless, socksGet } from './lib.mjs';

const arg = (n, d = '') => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] ?? '' : process.env['PROBE_' + n.toUpperCase().replace(/-/g, '_')] ?? d; };
const flag = (n) => process.argv.includes('--' + n);

const SUB = arg('sub');
const API = arg('api').replace(/\/$/, '');
const KEY = arg('key');
// Предпочтительно: отдельный токен пробы (админка → Сеть: аналитика → Токены), НЕ общий INTERNAL_KEY. Можно передать через env NETPROBE_WRITE_TOKEN.
const TOKEN = arg('token') || process.env.NETPROBE_WRITE_TOKEN || '';
const NAME = arg('name', 'probe');
const OPERATOR = arg('operator');
const XRAY = arg('xray', 'xray');
const TEST_URL = arg('test-url', 'http://cp.cloudflare.com/generate_204');
const TIMEOUT = Number(arg('timeout', '12000'));
const DRY = flag('dry');

if (!SUB) { console.error('Нужен --sub <ссылка подписки тестового пользователя>'); process.exit(2); }
if (!DRY && (!API || !(TOKEN || KEY))) { console.error('Нужны --api https://api.домен и токен пробы (--token или env NETPROBE_WRITE_TOKEN); устаревший вариант: --key <INTERNAL_KEY>. Флаг --dry — проверка без отправки'); process.exit(2); }

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const waitPort = async (port, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await new Promise((r) => { const c = net.connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); })) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

async function checkOne(link) {
  let v;
  try { v = parseVless(link); } catch (e) { return { target: 'ссылка', kind: 'vless', ok: false, detail: `не разобрана: ${e.message}` }; }
  const dir = mkdtempSync(join(tmpdir(), 'vprobe-'));
  const port = await freePort();
  let proc;
  try {
    writeFileSync(join(dir, 'c.json'), JSON.stringify(buildConfig(v, port)));
    proc = spawn(XRAY, ['run', '-c', join(dir, 'c.json')], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    let exited = false;
    proc.on('exit', () => { exited = true; });
    if (!(await waitPort(port, 4000)) || exited) return { target: v.remark, kind: 'vless', ok: false, detail: `xray не запустился: ${err.trim().split('\n').pop()?.slice(0, 120) ?? ''}` };
    // два запроса: первый включает рукопожатие, второй показывает «рабочую» задержку
    let last;
    for (let i = 0; i < 2; i++) {
      try { last = await socksGet(port, TEST_URL, TIMEOUT); } catch (e) { return { target: v.remark, kind: 'vless', ok: false, detail: String(e.message).slice(0, 150) }; }
    }
    const ok = last.status >= 200 && last.status < 400;
    return { target: v.remark, kind: 'vless', ok, ms: last.ms, ...(ok ? {} : { detail: `HTTP ${last.status}` }) };
  } finally {
    try { proc?.kill('SIGKILL'); } catch { /* уже завершён */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

const subRes = await fetch(SUB, { headers: { 'user-agent': 'Happ/1.0' }, signal: AbortSignal.timeout(15000) }).catch((e) => { console.error('Не удалось получить подписку:', e.message); process.exit(1); });
if (!subRes.ok) { console.error('Подписка вернула HTTP', subRes.status); process.exit(1); }
const links = extractLinks(await subRes.text());
if (!links.length) { console.error('В подписке нет ссылок vless://'); process.exit(1); }

const results = [];
for (const l of links.slice(0, 30)) results.push(await checkOne(l));
for (const r of results) console.log(`${r.ok ? 'OK ' : 'FAIL'} ${r.target}${r.ms != null ? ` ${r.ms} мс` : ''}${r.detail ? ' — ' + r.detail : ''}`);

if (!DRY) {
  // один reportId на запуск: ретраи не дублируют замеры; ретраи с jitter, ограниченный таймаут, секреты не печатаем
  const reportId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const headers = { 'content-type': 'application/json', ...(TOKEN ? { 'x-probe-token': TOKEN } : { 'x-internal-key': KEY }) };
  const body = JSON.stringify({ name: NAME, reportId, ...(OPERATOR ? { operator: OPERATOR } : {}), results });
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(API + '/api/v1/net/probe-report', { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
      if (r.ok) { lastErr = ''; break; }
      lastErr = `HTTP ${r.status}`;
      if (r.status < 500 && r.status !== 429) break; // повторять бессмысленно
    } catch (e) { lastErr = e?.name === 'TimeoutError' ? 'таймаут' : 'сеть недоступна'; }
    await new Promise((res) => setTimeout(res, 1000 * attempt + Math.random() * 1000));
  }
  if (lastErr) { console.error('API отклонил/не принял отчёт:', lastErr); process.exit(1); }
}
process.exit(results.every((r) => r.ok) ? 0 : 3);

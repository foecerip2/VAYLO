import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { sql } from '../db/index.js';
import { badRequest, escapeHtml, HttpError, notFound } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { alertAdmins } from './alerts.js';
import { remnawave } from './remnawave.js';
import { getSettings } from './settings.js';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Публичный ли адрес (не loopback / частный / link-local) */
export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  const l = ip.toLowerCase();
  return !(l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('::ffff:'));
}

/** Выдаёт (или перевыпускает) токен агента для ноды. Токен показывается один раз. */
export async function issueAgentToken(nodeUuid: string, nodeName: string | null, dnsName?: string | null): Promise<string> {
  const token = 'na_' + randomBytes(24).toString('base64url');
  await sql()`
    insert into node_agents (node_uuid, node_name, token_hash, dns_name) values (${nodeUuid}, ${nodeName}, ${hash(token)}, ${dnsName || null})
    on conflict (node_uuid) do update set token_hash = excluded.token_hash, node_name = excluded.node_name,
      dns_name = coalesce(excluded.dns_name, node_agents.dns_name)`;
  return token;
}

export async function revokeAgent(nodeUuid: string): Promise<void> {
  await sql()`delete from node_agents where node_uuid = ${nodeUuid}`;
}

export async function setDnsName(nodeUuid: string, dns: string | null): Promise<void> {
  if (dns && !/^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(dns)) throw badRequest('Некорректное DNS-имя');
  const r = await sql()`update node_agents set dns_name = ${dns || null} where node_uuid = ${nodeUuid} returning 1`;
  if (!r.length) throw notFound('Сначала создайте агента для ноды');
}

async function cloudflareUpsert(name: string, ip: string): Promise<string> {
  const cfg = await getSettings('nodeip');
  if (!cfg.cloudflare_token || !cfg.cloudflare_zone_id) throw new Error('Cloudflare не настроен');
  const type = isIP(ip) === 6 ? 'AAAA' : 'A';
  const base = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.cloudflare_zone_id)}/dns_records`;
  const headers = { authorization: `Bearer ${cfg.cloudflare_token}`, 'content-type': 'application/json' };
  const find = await fetch(`${base}?type=${type}&name=${encodeURIComponent(name)}`, { headers, signal: AbortSignal.timeout(15000) });
  const fj: any = await find.json().catch(() => null);
  if (!find.ok || !fj?.success) throw new Error(`Cloudflare: ${fj?.errors?.[0]?.message ?? find.status}`);
  const rec = fj.result?.[0];
  const body = JSON.stringify({ type, name, content: ip, ttl: 60, proxied: false });
  const res = await fetch(rec ? `${base}/${rec.id}` : base, { method: rec ? 'PUT' : 'POST', headers, body, signal: AbortSignal.timeout(15000) });
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j?.success) throw new Error(`Cloudflare: ${j?.errors?.[0]?.message ?? res.status}`);
  return `DNS ${name} → ${ip}`;
}

export interface ApplyResult {
  changed: boolean;
  ok: boolean;
  steps: string[];
}

/** Подставляет новый IP ноды в Remnawave (нода + хосты) и DNS. Идемпотентно. */
export async function applyNodeIp(nodeUuid: string, newIp: string, source: 'agent' | 'manual'): Promise<ApplyResult> {
  if (!isPublicIp(newIp)) throw badRequest('Нужен публичный IP-адрес');
  const cfg = await getSettings('nodeip');
  if (!cfg.enabled && source === 'agent') return { changed: false, ok: true, steps: ['Автоперенастройка выключена'] };
  const [agent] = await sql()`select * from node_agents where node_uuid = ${nodeUuid}`;
  const nodes = await remnawave.listNodes();
  const node = nodes.find((n) => n.uuid === nodeUuid);
  if (!node) throw notFound('Нода не найдена в Remnawave');
  const oldAddr = node.address ?? '';
  const steps: string[] = [];
  let ok = true;
  const oldIsIp = isIP(oldAddr) > 0;
  const dnsName: string | null = agent?.dns_name ?? (!oldIsIp && oldAddr ? oldAddr : null);

  if (oldAddr === newIp && !agent?.dns_name) {
    if (agent) await sql()`update node_agents set last_ip = ${newIp}, last_seen = now() where node_uuid = ${nodeUuid}`;
    return { changed: false, ok: true, steps: [] };
  }

  // Атомарно «занимаем» смену, чтобы параллельные отчёты не дублировали работу
  if (agent && source === 'agent') {
    const claimed = await sql()`update node_agents set last_ip = ${newIp}, last_seen = now() where node_uuid = ${nodeUuid} and last_ip is distinct from ${newIp} returning 1`;
    if (!claimed.length && oldAddr === newIp) return { changed: false, ok: true, steps: [] };
  }

  try {
    if (oldIsIp && oldAddr !== newIp) {
      await remnawave.updateNode(nodeUuid, { address: newIp });
      steps.push(`Нода: ${oldAddr} → ${newIp}`);
      if (cfg.update_hosts) {
        const hosts = (await remnawave.listHosts()).filter((h) => h.address === oldAddr);
        for (const h of hosts) {
          await remnawave.updateHost(h.uuid, { address: newIp });
          steps.push(`Хост «${h.remark ?? h.uuid.slice(0, 8)}» обновлён`);
        }
      }
    }
    if (dnsName) {
      try {
        steps.push(await cloudflareUpsert(dnsName, newIp));
      } catch (e) {
        ok = oldIsIp ? ok : false;
        steps.push(`⚠️ ${(e as Error).message}${oldIsIp ? '' : ' — обновите A-запись вручную'}`);
      }
    } else if (!oldIsIp) {
      ok = false;
      steps.push('Адрес ноды — домен: обновите A-запись вручную или задайте DNS-имя и Cloudflare');
    }
    if (cfg.restart_node) await remnawave.restartNode(nodeUuid).then(() => steps.push('Нода перезапущена')).catch((e) => steps.push(`⚠️ Перезапуск: ${(e as Error).message}`));
  } catch (e) {
    ok = false;
    steps.push(`Ошибка: ${(e as HttpError).detail ?? (e as Error).message}`);
    log.error('node ip apply failed', { nodeUuid, err: (e as Error).message });
  }

  if (agent) await sql()`update node_agents set last_ip = ${newIp}, last_seen = now() where node_uuid = ${nodeUuid}`;
  await sql()`insert into node_ip_changes (node_uuid, node_name, old_ip, new_ip, source, ok, detail) values (${nodeUuid}, ${node.name}, ${oldAddr || null}, ${newIp}, ${source}, ${ok}, ${steps.join('\n').slice(0, 2000)})`;
  void alertAdmins(
    `${ok ? '🔁' : '⚠️'} <b>Смена IP ноды ${escapeHtml(node.name)}</b>\n<code>${escapeHtml(oldAddr || '—')}</code> → <code>${escapeHtml(newIp)}</code> (${source === 'agent' ? 'агент' : 'вручную'})\n${steps.map(escapeHtml).join('\n')}`,
  );
  return { changed: true, ok, steps };
}

/** Отчёт агента: токен + реальный IP источника запроса */
export async function agentReport(token: string, ip: string): Promise<ApplyResult & { node: string }> {
  const [a] = await sql()`select * from node_agents where token_hash = ${hash(token)}`;
  if (!a) throw new HttpError(401, 'Неверный токен агента', 'unauthorized');
  await sql()`update node_agents set last_seen = now() where node_uuid = ${a.node_uuid}`;
  if (!isPublicIp(ip)) throw badRequest('Источник запроса не публичный IP');
  const r = await applyNodeIp(a.node_uuid, ip, 'agent');
  return { ...r, node: a.node_name ?? a.node_uuid };
}

export async function nodeIpOverview() {
  const agents = await sql()`select node_uuid, node_name, last_ip, last_seen, dns_name from node_agents`;
  const history = await sql()`select node_uuid, node_name, old_ip, new_ip, source, ok, detail, created_at from node_ip_changes order by created_at desc limit 30`;
  return { agents, history };
}

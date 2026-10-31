// Разбор ссылок VLESS и генерация конфига xray для пробы (без зависимостей)
import net from 'node:net';

/** Из ответа страницы подписки (base64 или обычный текст) достаём vless:// ссылки */
export function extractLinks(body) {
  let text = String(body).trim();
  if (!/:\/\//.test(text)) {
    try { text = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { /* не base64 */ }
  }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^vless:\/\//i.test(l));
}

/** vless://uuid@host:port?type=..&security=..#remark → объект */
export function parseVless(link) {
  const u = new URL(link.replace(/^vless:/i, 'http:'));
  const q = (k, d = '') => u.searchParams.get(k) ?? d;
  const remark = decodeURIComponent(u.hash.replace(/^#/, '')) || `${u.hostname}:${u.port}`;
  if (!u.username) throw new Error('в ссылке нет UUID');
  return {
    remark,
    id: decodeURIComponent(u.username),
    address: u.hostname.replace(/^\[|\]$/g, ''),
    port: Number(u.port || 443),
    network: q('type', 'tcp'),
    security: q('security', 'none'),
    flow: q('flow'),
    sni: q('sni') || q('host'),
    fp: q('fp', 'chrome'),
    pbk: q('pbk'),
    sid: q('sid'),
    spx: q('spx'),
    alpn: q('alpn'),
    path: q('path'),
    host: q('host'),
    mode: q('mode'),
    serviceName: q('serviceName'),
    extra: q('extra'),
  };
}

/** Конфиг xray: локальный SOCKS на указанном порту, выход через VLESS из ссылки */
export function buildConfig(v, socksPort) {
  const ss = { network: v.network === 'splithttp' ? 'xhttp' : v.network, security: v.security };
  if (v.security === 'reality') {
    if (!v.pbk) throw new Error('Reality без publicKey (pbk)');
    ss.realitySettings = { serverName: v.sni, fingerprint: v.fp, publicKey: v.pbk, shortId: v.sid, spiderX: v.spx || '' };
  } else if (v.security === 'tls') {
    ss.tlsSettings = { serverName: v.sni || v.address, fingerprint: v.fp, ...(v.alpn ? { alpn: v.alpn.split(',') } : {}) };
  }
  if (ss.network === 'ws') ss.wsSettings = { path: v.path || '/', headers: v.host ? { Host: v.host } : {} };
  if (ss.network === 'grpc') ss.grpcSettings = { serviceName: v.serviceName };
  if (ss.network === 'xhttp') {
    let extra;
    if (v.extra) { try { extra = JSON.parse(v.extra); } catch { /* игнорируем битый extra */ } }
    ss.xhttpSettings = { path: v.path || '/', host: v.host || v.sni || '', mode: v.mode || 'auto', ...(extra ? { extra } : {}) };
  }
  return {
    log: { loglevel: 'warning' },
    inbounds: [{ tag: 'in', listen: '127.0.0.1', port: socksPort, protocol: 'socks', settings: { auth: 'noauth', udp: false } }],
    outbounds: [{
      tag: 'out',
      protocol: 'vless',
      settings: { vnext: [{ address: v.address, port: v.port, users: [{ id: v.id, encryption: 'none', ...(v.flow ? { flow: v.flow } : {}) }] }] },
      streamSettings: ss,
    }],
  };
}

/** HTTP GET через SOCKS5 (для http://…/generate_204). Возвращает {status, ms}. */
export function socksGet(socksPort, url, timeoutMs) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const s = net.connect(socksPort, '127.0.0.1');
    const done = (fn, v) => { clearTimeout(timer); s.destroy(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('таймаут')), timeoutMs);
    let stage = 0;
    let buf = Buffer.alloc(0);
    s.on('error', (e) => done(reject, e));
    s.on('connect', () => s.write(Buffer.from([5, 1, 0])));
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2) {
        if (buf[0] !== 5 || buf[1] !== 0) return done(reject, new Error('SOCKS: отказ'));
        buf = buf.subarray(2);
        stage = 1;
        const host = Buffer.from(u.hostname);
        const port = Buffer.alloc(2);
        port.writeUInt16BE(Number(u.port || 80));
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, port]));
      }
      if (stage === 1 && buf.length >= 10) {
        if (buf[1] !== 0) return done(reject, new Error(`SOCKS: ошибка подключения (код ${buf[1]})`));
        buf = Buffer.alloc(0);
        stage = 2;
        s.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\nUser-Agent: vaylo-probe\r\n\r\n`);
      }
      if (stage === 2) {
        const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf.toString('latin1'));
        if (m) done(resolve, { status: Number(m[1]), ms: Date.now() - t0 });
      }
    });
  });
}

/** Безопасность AI-поддержки: редакция ПД, классификация темы, признаки эскалации. Чистые функции, без сети. */
export type Topic = 'network' | 'subscription' | 'payment' | 'app' | 'unknown';

const RULES: [RegExp, string][] = [
  [/https?:\/\/\S+/giu, '[ссылка]'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gu, '[email]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '[id]'],
  [/\b(?:vless|vmess|trojan|ss|hysteria2?):\/\/\S+/giu, '[ключ]'],
  [/\b(?:\d[ -]?){13,19}\b/gu, '[карта]'],
  [/(?<!\d)(?:\+?7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu, '[телефон]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[ip]'],
  [/\b[A-Za-z0-9_-]{32,}\b/gu, '[токен]'],
];
export function redactPII(text: string): string {
  return RULES.reduce((t, [re, to]) => t.replace(re, to), text);
}

const T: [Topic, RegExp][] = [
  ['payment', /оплат|платеж|платёж|списал|деньги|деньг|возврат|чек|карт[аыуой]|рефанд|refund|chargeback|юkassa|юкасса/iu],
  ['network', /не работает|не подключа|обрыв|отвал|медленн|тормоз|скорост|беспокой|билайн|мтс|мегафон|tele2|теле2|оператор|блокир|мобильн|wi-?fi|вайфай|пинг|таймаут|timeout|не грузит|не открыва/iu],
  ['subscription', /подписк|тариф|продл|истек|истёк|закончил|пробн|триал|устройств|лимит|ссылк[аи] подписк/iu],
  ['app', /happ|incy|karing|streisand|hiddify|v2box|приложени|iphone|айфон|android|андроид|windows|macos|установ|импорт|qr/iu],
];
export function classifyTopic(text: string): Topic {
  // платёжная тема приоритетнее: спорные деньги всегда к человеку
  for (const [t, re] of T) if (re.test(text)) return t;
  return 'unknown';
}

const HUMAN = /возврат|вернит[еь] деньги|рефанд|refund|chargeback|списал.*(дважды|два раза|лишн)|заблокир(овали|уйте) (мой )?аккаунт|доступ к аккаунту|смените? (мне )?(ноду|сервер)|удалит[еь] (мой )?аккаунт|жалоб|суд\b|роскомнадзор/iu;
export function needsHuman(text: string): boolean { return HUMAN.test(text); }

/** Краткое резюме тикета для оператора: тема + признаки + последние реплики пользователя без ПД. Только чтение. */
export function triageSummary(messages: { author: string; body: string }[]) {
  const user = messages.filter((m) => m.author === 'user').map((m) => m.body);
  const all = user.join('\n');
  const topic = classifyTopic(all);
  const human = needsHuman(all);
  const last = redactPII(user.slice(-2).join(' / ')).slice(0, 400);
  const hints: string[] = [];
  if (/ios|iphone|айфон/iu.test(all)) hints.push('iOS');
  if (/android|андроид/iu.test(all)) hints.push('Android');
  const op = /билайн|beeline/iu.test(all) ? 'Билайн' : /мтс/iu.test(all) ? 'МТС' : /мегафон/iu.test(all) ? 'МегаФон' : /tele2|теле2/iu.test(all) ? 'Tele2' : null;
  if (op) hints.push(op);
  return { topic, escalate: human || topic === 'payment', hints, lastUserText: last };
}

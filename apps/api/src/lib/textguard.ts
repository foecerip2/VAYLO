/**
 * Защита чата поддержки: фильтр мата (с учётом обхода: латиница вместо кириллицы, цифры, разделители, растянутые буквы)
 * и распознавание попыток «взломать» ИИ (prompt injection). Всё работает локально, без обращения к ИИ.
 */

const HOMOGLYPH: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и', r: 'г', i: 'и', l: 'л', n: 'н', d: 'д', z: 'з', s: 'с', w: 'ш', g: 'д', f: 'ф', v: 'в', j: 'й', q: 'к',
  '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а', '$': 'с', '1': 'и', '€': 'е',
};
const ZERO_WIDTH = /[​-‏⁠⁦-⁩﻿­]/g;

/** Приводит текст к «чистому» виду: нижний регистр, без невидимых символов, латиница/цифры → кириллица, ё → е */
export function normalizeText(s: string): string {
  const base = s.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase().replace(/ё/g, 'е');
  let out = '';
  for (const ch of base) out += HOMOGLYPH[ch] ?? ch;
  return out;
}

/** Только буквы подряд, повторы схлопнуты: «х.у.у.у.й» → «хуй» */
function squeeze(s: string): string {
  return s.replace(/[^а-яa-z]/g, '').replace(/(.)\1+/g, '$1');
}

// Слово целиком (после нормализации латиницы) — основы с приставками, чтобы не ловить «дебаты», «хлеб», «потребитель»
const TOKEN_PATTERNS: RegExp[] = [
  /^(за|вы|по|на|от|ото|у|съ|объ|рас|раз|при|до|под|пере|недо|с|о|об|не)?(ебат|ебан|ебал|ебну|ебуч|ебут|ебет|ебут|ебла|еблан|ебыр)/,
  /^(на|по|о|от|за|до|без|пере|не)?ху(й|и|е|я|ю)(?!ж|д|л|н|т|ч|б)/,
  /^(на|по|за|вы|рас|раз|с|у|от|до|об)?пизд/,
  /^бл(я|ь)(д|т)/,
  /^бл(т|ть)$/,
  /^су(ка|ки|ку|ке|кой|чк|чар|чье)/,
  /^муд(ак|ил|ло|аки|ила)/,
  /^(пид(о|а)р|пид(о|а)рас|педик|гомик)/,
  /^(г(о|а)ндон|залуп|шлюх|ублюд|дрочи|дроч|долбо(е|ё)б|долбаеб|мраз|твар)/,
  /^уеб/,
];
// Однозначные основы — ищем и в «склеенном» тексте (обход пробелами/точками: «х у й», «п.и.з.д.е.ц»)
const SQUEEZED_ROOTS = ['пизд', 'бляд', 'блят', 'блть', 'хуй', 'хуе', 'хуя', 'хуи', 'мудак', 'залуп', 'пидор', 'пидар', 'гондон', 'гандон', 'ебан', 'ебат', 'fuck', 'shit'];
// короткие/двусмысленные основы в «склеенном» тексте легко дают ложные срабатывания — ограничиваем ими не пользуемся
const SAFE_WORDS = /(хуже|хуже|худ|хулиган|хуторян|дебат|требат|ребат|скребат|небат|хлеб|потреб|употреб|употребл|уебаны?|бляшк|хуев?ин)/;

export interface GuardResult { bad: boolean; reason?: 'profanity' | 'injection' }

export function hasProfanity(raw: string): boolean {
  const plain = raw.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase().replace(/ё/g, 'е');
  // английский мат проверяем по исходным словам (без подмены латиницы на кириллицу)
  if (plain.split(/[^a-z0-9*]+/).some((w) => /^(fuck|fuk|shit|bitch|cunt|asshole|motherfuck|nigg|whore|slut)/.test(w.replace(/\*/g, 'u')))) return true;
  const norm = normalizeText(raw);
  const tokens = norm.split(/[^а-яa-z0-9*]+/).filter(Boolean);
  for (const t of tokens) {
    const w = t.replace(/\*/g, '');
    if (w.length < 2) continue;
    // «бл*ть», «х*й», «п*здец»: звёздочка как маска буквы
    if (t.includes('*')) {
      const masked = [/^бл\*ть$/, /^бл\*ть/, /^х\*й/, /^п\*зд/, /^еб\*н/, /^\*уй$/, /^пизд\*/].some((r) => r.test(t));
      if (masked) return true;
    }
    if (SAFE_WORDS.test(w) && !TOKEN_PATTERNS.some((r) => r.test(w))) continue;
    if (TOKEN_PATTERNS.some((r) => r.test(w))) return true;
  }
  const sq = squeeze(norm);
  // отдельные одиночные буквы через разделители → склеиваем только если исходник действительно «по буквам»
  const spaced = /(^|[\s.\-_*,])[а-яa-z]([\s.\-_*,]+[а-яa-z]){2,}($|[\s.\-_*,])/i.test(raw);
  if (spaced) {
    const joined = squeeze(norm.replace(/(?<=\b[а-яa-z])[\s.\-_*,]+(?=[а-яa-z]\b)/g, ''));
    if (SQUEEZED_ROOTS.some((r) => joined.includes(squeeze(r)))) return true;
  }
  // растянутые буквы и вставки между ними: «хууууй», «пиииздец»
  for (const r of ['пизд', 'бляд', 'блят', 'хуй', 'хуя', 'хуе', 'мудак', 'залуп']) {
    if (sq.length <= 40 && sq.includes(squeeze(r)) && tokens.length <= 3) {
      const hit = tokens.some((t) => squeeze(t).includes(squeeze(r)) && !SAFE_WORDS.test(t));
      if (hit) return true;
    }
  }
  return false;
}

const INJECTION: RegExp[] = [
  /(игнорир|забудь|отмени|сбрось|обнули|не\s+учитывай|отключи).{0,30}(инструкц|правил|промпт|указани|ограничен|предыдущ|систем)/,
  /ignore.{0,25}(previous|above|all|prior|your|the)\s*(instruction|rule|prompt|message)?/,
  /disregard.{0,20}(instruction|rule|prompt)/,
  /system\s*prompt|системн[а-яa-z0-9]*\s+(промпт|инструкц|сообщени)|промпт|prompt\s*injection/,
  /(?:^|[^а-я])(покажи|выведи|напиши|повтори|раскрой|пришли|скажи|процитируй|перескажи).{0,30}(инструкц|настройк|правил[а-яa-z0-9]*\s+(поддерж|работ)|свои\s+правила|изначальн)/,
  /(ты\s+теперь|с\s+этого\s+момента\s+ты|отныне\s+ты|ты\s+больше\s+не|ты\s+должен\s+притвор)/,
  /(притворись|представь,?\s*что\s+ты|веди\s+себя\s+как|играй\s+роль|roleplay|act\s+as|pretend\s+(to\s+be|you))/,
  /\bdan\b|jailbreak|developer\s*mode|режим\s+(разработчик|бога|без\s+(ограничен|цензур|фильтр))|do\s+anything\s+now|без\s+цензуры/,
  /\[\s*(system|assistant|inst|sys)\s*\]|<\s*\/?\s*(system|assistant|instructions?)\s*>|###\s*(system|instruction)/,
  /(api[\s_-]?key|апи[\s-]?ключ|ключ\s+api|токен\s+бота|bot\s*token|секретн[а-яa-z0-9]+\s+ключ|пароль\s+(от\s+)?(админ|базы|сервера)|переменн[а-яa-z0-9]+\s+окружен)/,
  /(данн[а-яa-z0-9]*|подписк[а-яa-z0-9]*|баланс|ссылк[а-яa-z0-9]*|пароль|аккаунт)\s+(другого|чужого|другого\s+пользовател|всех\s+пользовател)/,
  /(sql|drop\s+table|union\s+select|<script|javascript:)/,
  /base64|rot13|переведи\s+в\s+(hex|base64)/,
];

export function looksLikeInjection(raw: string): boolean {
  const n = normalizeText(raw).replace(/\s+/g, ' ');
  const plain = raw.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  return INJECTION.some((r) => r.test(plain) || r.test(n));
}

export function guardText(raw: string): GuardResult {
  if (hasProfanity(raw)) return { bad: true, reason: 'profanity' };
  if (looksLikeInjection(raw)) return { bad: true, reason: 'injection' };
  return { bad: false };
}

/** Деньги: споры по платежам, возвраты, пропавшие деньги — их решает человек, ИИ не отвечает */
export const MONEY_PROBLEM = /(возврат|верн(и|ите|уть)\s+(мне\s+)?(деньг|средств|оплат)|списал[аи]?|списан[оы]?|не\s+(пришл|зачисл|дошл|поступил)|пропал[аи]?\s+(мо[ия]\s+)?(деньг|оплат|баланс)|двойн\w+\s+(спис|оплат)|дважды\s+(спис|оплат)|мошенн|обманул|чарджбек|chargeback|refund|вывод\s+(средств|денег)|оплатил[аи]?\s*,?\s*(но|а)\s+(нет|не))/;
export const WANTS_HUMAN = /(живо(й|го)\s+(человек|оператор|сотрудник)|оператор|человек(а)?\s+(позов|нужен|хочу)|позови\s+(человек|админ|оператор)|свяжите\s+с\s+(человек|оператор|админ)|хочу\s+(к\s+)?(человек|оператор|админ)|администратор|поддержк[ауе]\s+человек)/;

/** Чистит ответ ИИ: убирает служебные теги, ссылки на чужие домены, возможные утечки ключей и инструкций */
export function sanitizeAiReply(text: string, allowedHosts: string[]): { text: string; escalate: 'important' | 'urgent' | null; leaked: boolean } {
  let escalate: 'important' | 'urgent' | null = null;
  let t = text.replace(/\[\[\s*ESCALATE\s*:?\s*(important|urgent)?\s*\]\]/gi, (_m, p) => {
    escalate = (String(p ?? 'important').toLowerCase() === 'urgent' ? 'urgent' : 'important') as 'important' | 'urgent';
    return '';
  });
  t = t.replace(/<[^>]{1,200}>/g, '').replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '')).trim();
  const leaked = /ПРАВИЛА_ПОДДЕРЖКИ|БЛОК ДАННЫХ|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]+-----|ESCALATE/i.test(t);
  t = t.replace(/https?:\/\/[^\s)]+/gi, (u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return allowedHosts.some((a) => h === a || h.endsWith('.' + a)) ? u : '';
    } catch {
      return '';
    }
  });
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1800);
  return { text: t, escalate, leaked };
}

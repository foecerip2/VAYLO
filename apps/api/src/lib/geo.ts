/** Определение страны/координат сервера: код из Remnawave → флаг-эмодзи в названии → название страны/города → код в имени. */
// код: [широта, долгота, названия и города через |, нижний регистр]
const C: Record<string, [number, number, string]> = {
  DE: [51.2, 10.4, 'germany|германия|frankfurt|франкфурт|berlin|берлин|munich|мюнхен|falkenstein|nuremberg|нюрнберг'],
  NL: [52.1, 5.3, 'netherlands|нидерланды|голландия|holland|amsterdam|амстердам|rotterdam'],
  PL: [52.0, 19.1, 'poland|польша|warsaw|варшава'], FI: [64.0, 26.0, 'finland|финляндия|helsinki|хельсинки'],
  SE: [62.0, 15.0, 'sweden|швеция|stockholm|стокгольм'], NO: [61.0, 9.0, 'norway|норвегия|oslo|осло'], DK: [56.0, 10.0, 'denmark|дания|copenhagen'],
  LV: [56.9, 24.6, 'latvia|латвия|riga|рига'], LT: [55.2, 23.9, 'lithuania|литва|vilnius|вильнюс'], EE: [58.6, 25.0, 'estonia|эстония|tallinn|таллин'],
  FR: [46.6, 2.4, 'france|франция|paris|париж|marseille'], GB: [54.0, -2.5, 'united kingdom|великобритания|англия|england|london|лондон|uk'],
  IE: [53.2, -8.2, 'ireland|ирландия|dublin'], ES: [40.2, -3.7, 'spain|испания|madrid|мадрид'], PT: [39.6, -8.0, 'portugal|португалия|lisbon'],
  IT: [42.8, 12.6, 'italy|италия|milan|милан|rome|рим'], CH: [46.8, 8.2, 'switzerland|швейцария|zurich|цюрих'], AT: [47.6, 14.1, 'austria|австрия|vienna|вена'],
  CZ: [49.8, 15.5, 'czech|чехия|prague|прага'], SK: [48.7, 19.7, 'slovakia|словакия'], HU: [47.2, 19.5, 'hungary|венгрия|budapest|будапешт'],
  RO: [45.9, 24.9, 'romania|румыния|bucharest'], BG: [42.7, 25.5, 'bulgaria|болгария|sofia|софия'], GR: [39.0, 22.0, 'greece|греция|athens'],
  TR: [39.0, 35.2, 'turkey|турция|istanbul|стамбул'], UA: [49.0, 31.4, 'ukraine|украина|kyiv|киев'], MD: [47.2, 28.5, 'moldova|молдова'],
  RS: [44.0, 21.0, 'serbia|сербия|belgrade'], CY: [35.0, 33.0, 'cyprus|кипр'], IL: [31.5, 34.8, 'israel|израиль'], BY: [53.7, 27.9, 'belarus|беларусь'],
  RU: [61.5, 99.0, 'russia|россия|moscow|москва|петербург|spb|новосибирск'], KZ: [48.0, 67.0, 'kazakhstan|казахстан|almaty|алматы'],
  GE: [42.3, 43.4, 'georgia|грузия|tbilisi|тбилиси'], AM: [40.3, 44.9, 'armenia|армения|yerevan'], AZ: [40.3, 47.7, 'azerbaijan|азербайджан|baku'],
  UZ: [41.4, 64.6, 'uzbekistan|узбекистан'], US: [39.5, -98.4, 'united states|usa|сша|америка|new york|нью-йорк|los angeles|miami|майами|chicago|dallas|seattle|ashburn'],
  CA: [56.0, -96.0, 'canada|канада|toronto|montreal'], BR: [-10.0, -52.0, 'brazil|бразилия|sao paulo'], AR: [-34.0, -64.0, 'argentina|аргентина'],
  MX: [23.6, -102.5, 'mexico|мексика'], CL: [-33.5, -70.6, 'chile|чили'], CO: [4.6, -74.1, 'colombia|колумбия'],
  AE: [24.0, 54.0, 'emirates|оаэ|uae|dubai|дубай'], SA: [24.0, 45.0, 'saudi|саудовская'], IN: [21.0, 78.0, 'india|индия|mumbai|мумбаи'],
  SG: [1.35, 103.8, 'singapore|сингапур'], JP: [36.2, 138.2, 'japan|япония|tokyo|токио|osaka'], KR: [36.5, 127.9, 'korea|корея|seoul|сеул'],
  HK: [22.3, 114.2, 'hong kong|гонконг'], TW: [23.7, 121.0, 'taiwan|тайвань'], CN: [35.0, 103.0, 'china|китай'], AU: [-25.0, 134.0, 'australia|австралия|sydney|сидней'],
  NZ: [-41.0, 174.0, 'new zealand|новая зеландия'], TH: [15.0, 101.0, 'thailand|таиланд|bangkok'], VN: [16.0, 107.8, 'vietnam|вьетнам'],
  ID: [-2.0, 118.0, 'indonesia|индонезия'], MY: [4.2, 102.0, 'malaysia|малайзия'], PH: [12.9, 122.0, 'philippines|филиппины'],
  ZA: [-29.0, 24.0, 'south africa|юар|johannesburg'], EG: [26.8, 30.8, 'egypt|египет'], NG: [9.1, 8.7, 'nigeria|нигерия'], KE: [0.2, 37.9, 'kenya|кения'],
  IS: [64.9, -18.6, 'iceland|исландия'], LU: [49.8, 6.1, 'luxembourg|люксембург'], BE: [50.6, 4.6, 'belgium|бельгия|brussels'],
  HR: [45.1, 15.2, 'croatia|хорватия'], SI: [46.1, 14.8, 'slovenia|словения'], AL: [41.1, 20.1, 'albania|албания'], KG: [41.2, 74.8, 'kyrgyz|киргизия'],
  MN: [46.9, 103.8, 'mongolia|монголия'], PK: [30.0, 69.0, 'pakistan|пакистан'], BD: [23.7, 90.3, 'bangladesh|бангладеш'], LK: [7.8, 80.7, 'sri lanka|шри-ланка'],
};

export const COUNTRY_COORDS: Record<string, [number, number]> = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, [v[0], v[1]]]));
const NAMES = Object.entries(C).map(([code, v]) => [code, v[2].split('|')] as const);

const validCode = (c?: string | null) => (c && /^[A-Za-z]{2}$/.test(c.trim()) && !['XX', 'ZZ'].includes(c.trim().toUpperCase()) ? c.trim().toUpperCase() : null);

/** Страна по названию сервера: флаг-эмодзи, название страны/города, отдельный двухбуквенный код (DE-1, nl_fra, [US]) */
export function countryFromName(name: string): string | null {
  const flags = [...name.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)];
  for (const m of flags) {
    const code = String.fromCharCode(...[...m[0]].map((ch) => ch.codePointAt(0)! - 0x1f1a5));
    if (C[code]) return code;
  }
  const low = name.toLowerCase();
  for (const [code, words] of NAMES) for (const w of words) {
    if (w.length < 3) continue;
    if (low.includes(w)) return code;
  }
  for (const tok of name.split(/[^A-Za-z]+/)) {
    const code = tok.toUpperCase();
    if (tok.length === 2 && C[code] && tok === tok.toUpperCase()) return code;
  }
  for (const tok of low.split(/[^a-z]+/)) { if (tok.length === 2 && C[tok.toUpperCase()]) return tok.toUpperCase(); }
  return null;
}

const geoCache = new Map<string, { at: number; v: { cc: string; lat: number; lng: number } | null }>();
/** GeoIP по адресу ноды (кэш на сутки; при недоступности сервиса — null) */
export async function geoByHost(host: string): Promise<{ cc: string; lat: number; lng: number } | null> {
  const key = host.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < (hit.v ? 86_400_000 : 600_000)) return hit.v;
  let v: { cc: string; lat: number; lng: number } | null = null;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(host)}?fields=success,country_code,latitude,longitude`, { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { success?: boolean; country_code?: string; latitude?: number; longitude?: number };
    const cc = validCode(j.country_code);
    if (j.success && cc && typeof j.latitude === 'number' && typeof j.longitude === 'number') v = { cc, lat: j.latitude, lng: j.longitude };
  } catch { /* нет сети/лимит — попробуем позже */ }
  geoCache.set(key, { at: Date.now(), v });
  return v;
}

export interface GeoPoint { countryCode: string | null; lat: number | null; lng: number | null }
/** Итоговая точка для узла: сначала то, что надёжно известно, GeoIP — последним средством */
export async function resolveGeo(n: { name: string; address?: string | null; countryCode?: string | null }): Promise<GeoPoint> {
  const cc = validCode(n.countryCode) ?? countryFromName(n.name);
  if (cc && COUNTRY_COORDS[cc]) return { countryCode: cc, lat: COUNTRY_COORDS[cc]![0], lng: COUNTRY_COORDS[cc]![1] };
  if (n.address) {
    const g = await geoByHost(n.address.replace(/^https?:\/\//, '').split(/[/:]/)[0]!);
    if (g) return { countryCode: g.cc, lat: g.lat, lng: g.lng };
  }
  return { countryCode: cc, lat: null, lng: null };
}
export function pointByCode(code?: string | null): GeoPoint {
  const cc = validCode(code);
  return cc && COUNTRY_COORDS[cc] ? { countryCode: cc, lat: COUNTRY_COORDS[cc]![0], lng: COUNTRY_COORDS[cc]![1] } : { countryCode: cc, lat: null, lng: null };
}

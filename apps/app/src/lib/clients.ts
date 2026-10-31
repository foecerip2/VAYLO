/** VPN-клиенты, с которыми работает подписка Remnawave. Ссылки на магазины можно править здесь. */
export type OS = 'ios' | 'android' | 'windows' | 'macos' | 'linux';

export interface VpnClient {
  id: string;
  name: string;
  os: OS[];
  /** глубокая ссылка импорта подписки */
  deeplink: (subUrl: string) => string;
  store: Partial<Record<OS, string>>;
  note?: string;
}

export const CLIENTS: VpnClient[] = [
  {
    id: 'happ',
    name: 'Happ',
    os: ['ios', 'android', 'windows', 'macos'],
    deeplink: (u) => `happ://add/${u}`,
    store: { ios: 'https://apps.apple.com/app/happ-proxy-utility/id6504287215', android: 'https://play.google.com/store/apps/details?id=com.happproxy', windows: 'https://github.com/Happ-proxy/happ-desktop/releases/latest', macos: 'https://apps.apple.com/app/happ-proxy-utility/id6504287215' },
    note: 'Простой клиент для подключения',
  },
  {
    id: 'hiddify',
    name: 'Hiddify',
    os: ['android', 'windows', 'macos', 'linux', 'ios'],
    deeplink: (u) => `hiddify://import/${u}`,
    store: { android: 'https://play.google.com/store/apps/details?id=app.hiddify.com', ios: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532', windows: 'https://github.com/hiddify/hiddify-app/releases/latest', macos: 'https://github.com/hiddify/hiddify-app/releases/latest', linux: 'https://github.com/hiddify/hiddify-app/releases/latest' },
  },
  {
    id: 'incy',
    name: 'Incy',
    os: ['ios', 'android', 'windows', 'macos', 'linux'],
    deeplink: (u) => `incy://import/${u}`,
    store: { ios: 'https://apps.apple.com/us/app/incy/id6756943388', android: 'https://play.google.com/store/apps/details?id=llc.itdev.incy', windows: 'https://github.com/INCY-DEV/incy-platforms/releases', macos: 'https://github.com/INCY-DEV/incy-platforms/releases', linux: 'https://github.com/INCY-DEV/incy-platforms/releases' },
    note: 'Доступность в магазине зависит от региона аккаунта',
  },
  {
    id: 'karing',
    name: 'Karing',
    os: ['ios', 'android', 'windows', 'macos', 'linux'],
    deeplink: (u) => `karing://install-config?url=${encodeURIComponent(u)}&name=VAYLO`,
    store: { ios: 'https://apps.apple.com/us/app/karing/id6472431552', android: 'https://karing.app/download', windows: 'https://karing.app/download', macos: 'https://karing.app/download', linux: 'https://karing.app/download' },
    note: 'Раздельные маршруты: что через VPN, что напрямую',
  },
  {
    id: 'streisand',
    name: 'Streisand',
    os: ['ios', 'macos'],
    deeplink: (u) => `streisand://import/${u}`,
    store: { ios: 'https://apps.apple.com/app/streisand/id6450534064', macos: 'https://apps.apple.com/app/streisand/id6450534064' },
  },
];

export function detectOS(ua = navigator.userAgent, platform = (navigator as any).userAgentData?.platform ?? navigator.platform ?? ''): OS {
  const s = `${ua} ${platform}`.toLowerCase();
  if (/iphone|ipad|ipod/.test(s) || (/mac/.test(s) && (navigator as any).maxTouchPoints > 1)) return 'ios';
  if (/android/.test(s)) return 'android';
  if (/win/.test(s)) return 'windows';
  if (/mac/.test(s)) return 'macos';
  return 'linux';
}

export const OS_LABEL: Record<OS, string> = { ios: 'iPhone / iPad', android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export function clientsFor(os: OS): VpnClient[] {
  return CLIENTS.filter((c) => c.os.includes(os));
}

/** Ссылка-мост /import?client=…&url=…: открывает приложение-клиент с уже добавленной подпиской */
export const importUrl = (client: string, sub: string) => `${location.origin}/import?client=${client}&url=${encodeURIComponent(sub)}`;

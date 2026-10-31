import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

export function applyTheme(mode: ThemeMode, tg?: { bg?: string }) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  void tg;
}

export function useTheme(storageKey = 'theme'): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      return (localStorage.getItem(storageKey) as ThemeMode) || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(storageKey, mode);
    } catch {
      /* ignore */
    }
  }, [mode, storageKey]);
  return [mode, setMode];
}

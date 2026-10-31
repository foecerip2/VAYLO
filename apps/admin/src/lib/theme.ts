import { useEffect, useState } from 'react';

export type AdminTheme = 'dark' | 'light';
const KEY = 'admin-theme';

/** Сохранённая тема; без выбора — по настройке системы (по умолчанию тёмная) */
export function readTheme(): AdminTheme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  try { if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'; } catch { /* ignore */ }
  return 'dark';
}

export function applyAdminTheme(t: AdminTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  root.style.colorScheme = t;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'dark' ? '#09090f' : '#f6f4fc');
}

export function useAdminTheme(): [AdminTheme, (t: AdminTheme) => void] {
  const [theme, setTheme] = useState<AdminTheme>(() => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<AdminTheme>).detail);
    window.addEventListener('admin-theme', on);
    return () => window.removeEventListener('admin-theme', on);
  }, []);
  const set = (t: AdminTheme) => {
    applyAdminTheme(t);
    try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('admin-theme', { detail: t }));
  };
  return [theme, set];
}

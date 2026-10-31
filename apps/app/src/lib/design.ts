import { miniAppDesign, resolveMiniAppDesign } from '@vpn/shared';
import { useLayoutEffect } from 'react';
import { useConfig } from './queries';
import { applyTelegramTheme } from './tg';

const CACHE_KEY = 'vaylo-miniapp-design-v1';

/** Cache only appearance, never identity or a preview override. Server config wins. */
export function applyMiniAppDesign(value: unknown) {
  const design = miniAppDesign(value);
  const root = document.documentElement;
  root.classList.add('neon');
  root.dataset.design = design.id;
  root.dataset.theme = design.mode;
  root.style.colorScheme = design.mode;
  // Old Telegram/custom accent values must not leak into the selected palette.
  for (const key of ['--primary', '--bg', '--surface', '--surface-2', '--text', '--text-muted']) root.style.removeProperty(key);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', design.background);
  applyTelegramTheme();
  try { localStorage.setItem(CACHE_KEY, design.id); } catch { /* private WebView */ }
}

export function bootstrapMiniAppDesign() {
  let cached: unknown;
  try { cached = localStorage.getItem(CACHE_KEY); } catch { /* private WebView */ }
  applyMiniAppDesign(cached);
}

export function useMiniAppDesign() {
  const config = useConfig();
  return miniAppDesign(resolveMiniAppDesign(config.data ? config.data.appearance.design : document.documentElement.dataset.design));
}

export function usePublishedMiniAppDesign() {
  const config = useConfig();
  useLayoutEffect(() => {
    if (config.data) applyMiniAppDesign(config.data.appearance.design);
  }, [config.data]);
}

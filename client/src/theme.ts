// Per-device colour theme (dark default, opt-in light mode).
//
// The choice is a local preference, not auction state: the auctioneer's laptop,
// each captain's phone and the projector each pick their own. It's applied by
// stamping <html data-theme="…">, which re-points the CSS variables in
// styles.css. main.tsx applies it before React mounts so there's no flash.

import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'dpl.theme';

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark'; // private mode / storage disabled — keep the default
  }
}

/** Reflect the theme onto <html> so the CSS variable overrides take effect. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Live theme state plus a toggle; persists the choice and repaints instantly. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const toggle = useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore — preference just won't persist */
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}

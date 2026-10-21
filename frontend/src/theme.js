const KEY = 'gauamrut-theme';
export const THEME_MODES = ['light', 'dark', 'system'];

export function systemTheme() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode) {
  const resolved = mode === 'system' ? systemTheme() : mode;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0c1512' : '#155c42');
}

export function getThemeMode() {
  try {
    const value = localStorage.getItem(KEY);
    return THEME_MODES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function setThemeMode(mode) {
  const next = THEME_MODES.includes(mode) ? mode : 'system';
  try { localStorage.setItem(KEY, next); } catch { /* private mode: keep session-only */ }
  applyTheme(next);
}

export const nextThemeMode = mode => THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];

export function initTheme() {
  applyTheme(getThemeMode());
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener?.('change', () => { if (getThemeMode() === 'system') applyTheme('system'); });
    window.addEventListener('storage', e => { if (e.key === KEY) applyTheme(getThemeMode()); });
  }
}

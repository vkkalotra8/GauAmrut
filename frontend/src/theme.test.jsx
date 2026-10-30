import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  THEME_MODES, applyTheme, getThemeMode, initTheme, nextThemeMode, setThemeMode, systemTheme
} from './theme';
import ThemeToggle from './components/ThemeToggle';

const INDEX_HTML = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

/**
 * jsdom has no prefers-color-scheme, so stand one in. The returned handle lets
 * a test flip the OS setting afterwards, which is the only way to observe the
 * live `change` listener initTheme() installs.
 */
function installSystemPrefersDark(matches) {
  const listeners = new Set();
  const query = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matches; },
    addEventListener: (type, fn) => { if (type === 'change') listeners.add(fn); },
    removeEventListener: (type, fn) => listeners.delete(fn),
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
    onchange: null,
    dispatchEvent: () => true
  };
  window.matchMedia = () => query;
  return {
    set next(value) {
      matches = value;
      for (const fn of listeners) fn({ matches, media: query.media });
    }
  };
}

function ensureThemeColorMeta() {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  return meta;
}

const themeOf = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
  installSystemPrefersDark(false);
  ensureThemeColorMeta().setAttribute('content', '');
});

afterEach(() => { vi.restoreAllMocks(); });

describe('theme resolution', () => {
  test('defaults to light when nothing is saved and the OS prefers light', () => {
    expect(getThemeMode()).toBe('system');
    initTheme();
    expect(systemTheme()).toBe('light');
    expect(themeOf()).toBe('light');
  });

  test('follows an OS preference of dark when the user has chosen nothing', () => {
    installSystemPrefersDark(true);
    initTheme();
    expect(systemTheme()).toBe('dark');
    expect(themeOf()).toBe('dark');
  });

  test('applies an explicit selection immediately, not on next load', () => {
    initTheme();
    setThemeMode('dark');
    expect(themeOf()).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    setThemeMode('light');
    expect(themeOf()).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  test('persists the choice so it survives a reload', () => {
    setThemeMode('dark');
    expect(localStorage.getItem('gauamrut-theme')).toBe('dark');

    // Simulate a fresh page: the attribute is gone, only storage remains.
    document.documentElement.removeAttribute('data-theme');
    expect(themeOf()).toBeNull();

    initTheme();
    expect(themeOf()).toBe('dark');
  });

  test('system mode tracks the OS live and stops once the user overrides it', () => {
    const os = installSystemPrefersDark(false);
    initTheme();
    setThemeMode('system');
    expect(themeOf()).toBe('light');

    os.next = true;
    expect(themeOf()).toBe('dark');

    // The listener must be inert once the choice is explicit.
    setThemeMode('light');
    os.next = false;
    expect(themeOf()).toBe('light');
  });

  test('applies a theme change broadcast from another tab', () => {
    initTheme();
    expect(themeOf()).toBe('light');
    localStorage.setItem('gauamrut-theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'gauamrut-theme', newValue: 'dark' }));
    expect(themeOf()).toBe('dark');
  });

  test('falls back safely when storage is empty, corrupt, or blocked', () => {
    for (const bad of ['', 'neon', 'DARK', '{}']) {
      localStorage.setItem('gauamrut-theme', bad);
      expect(getThemeMode()).toBe('system');
      initTheme();
      expect(themeOf()).toBe('light');
    }
  });

  test('cycles light → dark → system → light', () => {
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
    expect(nextThemeMode('system')).toBe('light');
    expect(nextThemeMode(undefined)).toBe('light');
    expect(THEME_MODES).toEqual(['light', 'dark', 'system']);
  });

  test('keeps the browser chrome colour in step with the theme', () => {
    const meta = ensureThemeColorMeta();
    applyTheme('light');
    expect(meta.getAttribute('content')).toBe('#F8FAFC');
    applyTheme('dark');
    expect(meta.getAttribute('content')).toBe('#0B1220');
  });

  test('does not persist a mode the app does not understand', () => {
    setThemeMode('sepia');
    expect(localStorage.getItem('gauamrut-theme')).toBe('system');
  });
});

describe('initial paint guard', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/);

  test('index.html declares a theme colour instead of the retired dark green', () => {
    expect(html).toMatch(/<meta name="theme-color" content="#F8FAFC"\/>/);
    expect(html).not.toContain('#155c42');
    expect(html).not.toContain('#0c1512');
  });

  test('runs a blocking script before the app mounts, so dark mode never flashes white', () => {
    expect(inline).toBeTruthy();
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<div id="root">'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('/src/main.jsx'));
  });

  test('the blocking script applies the stored theme to <html>', () => {
    localStorage.setItem('gauamrut-theme', 'dark');
    document.documentElement.removeAttribute('data-theme');
    new Function(inline[1])();
    expect(themeOf()).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  test('the blocking script falls back to light when the OS prefers light', () => {
    installSystemPrefersDark(false);
    localStorage.removeItem('gauamrut-theme');
    document.documentElement.removeAttribute('data-theme');
    new Function(inline[1])();
    expect(themeOf()).toBe('light');
  });
});

describe('ThemeToggle', () => {
  test('renders the current mode and switches to the next one on click', () => {
    // Start from an explicit mode so the cycle is deterministic: the toggle
    // always advances light → dark → system → light.
    setThemeMode('light');
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: /Theme/ });
    expect(button).toHaveAccessibleName(/Theme: Light\. /);

    fireEvent.click(button);
    expect(localStorage.getItem('gauamrut-theme')).toBe('dark');
    expect(themeOf()).toBe('dark');
    expect(button).toHaveAccessibleName(/Theme: Dark\. /);

    fireEvent.click(button);
    expect(localStorage.getItem('gauamrut-theme')).toBe('system');
    // data-theme holds the *resolved* value, so system with a light OS reads light.
    expect(themeOf()).toBe('light');
    expect(button).toHaveAccessibleName(/Theme: System\. /);

    fireEvent.click(button);
    expect(localStorage.getItem('gauamrut-theme')).toBe('light');
    expect(themeOf()).toBe('light');
    expect(button).toHaveAccessibleName(/Theme: Light\. /);
  });
});

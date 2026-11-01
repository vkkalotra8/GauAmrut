import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import { getThemeMode, nextThemeMode, setThemeMode } from '../theme';

const ICONS = { light: Sun, dark: Moon, system: Monitor };

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [mode, setMode] = useState(getThemeMode);
  const Icon = ICONS[mode];
  const labels = { light: t('theme.light', 'Light'), dark: t('theme.dark', 'Dark'), system: t('theme.system', 'System') };
  const next = nextThemeMode(mode);
  function cycle() { setThemeMode(next); setMode(next); }
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={cycle}
      aria-label={`${t('theme.label', 'Theme')}: ${labels[mode]}. ${t('theme.switchTo', 'Switch to')} ${labels[next]}`}
      title={`${t('theme.label', 'Theme')}: ${labels[mode]} → ${labels[next]}`}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

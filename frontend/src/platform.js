import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { api } from './lib';

// Client-side mirror of the public /api/platform/settings payload. These
// fallbacks apply until (or instead of) a successful load, so every consumer
// behaves exactly like the pre-platform-settings app when nothing is set.
export const platformFallback = {
  announcement: { enabled: false, message: '' },
  support: { email: '', phone: '' },
  defaults: { cowRatePaise: 6000, buffaloRatePaise: 8000 },
  invoice: { footer: '' },
  registration: { open: true }
};

function mergeSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pick = key => ({
    ...platformFallback[key],
    ...(s[key] && typeof s[key] === 'object' && !Array.isArray(s[key]) ? s[key] : {})
  });
  return {
    announcement: pick('announcement'),
    support: pick('support'),
    defaults: pick('defaults'),
    invoice: pick('invoice'),
    registration: pick('registration')
  };
}

let cache = null;
let inflight = null;
const listeners = new Set();

// Fetch (or re-fetch) the platform settings once per app session. Every
// mounted consumer receives the fresh value through its listener, which is
// how a super admin's saved change becomes visible instantly in their own
// console; other signed-in users pick it up on their next load or window
// focus.
export function refreshPlatformSettings() {
  if (inflight) return inflight;
  inflight = Promise.resolve()
    .then(() => api.get('/platform/settings'))
    .then(r => {
      cache = mergeSettings(r?.data?.data);
      listeners.forEach(fn => fn(cache));
      return cache;
    })
    .catch(() => {
      inflight = null;
      return cache || platformFallback;
    });
  return inflight;
}

// Drop the cached value and fetch again. Called after a settings save so the
// banner/defaults update immediately without a page reload.
export function invalidatePlatformSettings() {
  cache = null;
  inflight = null;
  return refreshPlatformSettings();
}

export function usePlatformSettings() {
  const { user, demo } = useSelector(s => s.session);
  const [settings, setSettings] = useState(cache);
  const active = Boolean(user) && !demo;
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const apply = value => { if (alive) setSettings(value); };
    listeners.add(apply);
    const onFocus = () => { inflight = null; refreshPlatformSettings(); };
    if (cache) apply(cache); else refreshPlatformSettings();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; listeners.delete(apply); window.removeEventListener('focus', onFocus); };
  }, [active]);
  return active ? settings : null;
}

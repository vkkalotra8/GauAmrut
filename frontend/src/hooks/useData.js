import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { api, message } from '../lib';
import { getCachedRoute, setCachedRoute } from '../offline';

export default function useData(path, example = null) {
  const { demo, user } = useSelector(s => s.session);
  const [state, setState] = useState({ data: demo ? example : null, loading: !demo, error: '', meta: null, cached: false });
  const [revision, setRevision] = useState(0);
  // Keep the latest example in a ref: callers may pass a fresh [] on every
  // render, which must not re-trigger the load effect (it caused an
  // infinite fetch/abort loop and "Maximum update depth" warnings).
  const exampleRef = useRef(example);
  exampleRef.current = example;
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener('delivery-synced', refresh);
    return () => window.removeEventListener('delivery-synced', refresh);
  }, []);
  useEffect(() => {
    if (demo) { setState({ data: exampleRef.current, loading: false, error: '', meta: null, cached: false }); return; }
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      if (!navigator.onLine && path.startsWith('/customers') && user?.id) {
        const cached = await getCachedRoute(user.id, path);
        if (cached && !cancelled) {
          setState({ data: cached.data, meta: cached.meta, loading: false, error: '', cached: true, cachedAt: cached.cachedAt });
          return;
        }
      }
      setState(s => ({ ...s, loading: true, error: '' }));
      try {
        const r = await api.get(path, { signal: controller.signal });
        if (!cancelled) {
          setState({ data: r.data.data, meta: r.data.meta, loading: false, error: '', cached: false });
          if (path.startsWith('/customers') && user?.id) {
            setCachedRoute(user.id, path, r.data.data, r.data.meta);
          }
        }
      } catch (e) {
        if (e.code === 'ERR_CANCELED' || cancelled) return;
        if (path.startsWith('/customers') && user?.id) {
          const cached = await getCachedRoute(user.id, path);
          if (cached && !cancelled) {
            setState({ data: cached.data, meta: cached.meta, loading: false, error: '', cached: true, cachedAt: cached.cachedAt });
            return;
          }
        }
        setState({ data: null, loading: false, error: message(e), cached: false });
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, demo, user?.id, revision]);
  return { ...state, reload: () => setRevision(n => n + 1) };
}


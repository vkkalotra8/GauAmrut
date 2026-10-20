import { openDB } from 'idb';
import { api, store } from './lib';

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gauamrut-offline') : null;
if (channel) {
  channel.onmessage = (event) => {
    if (event.data === 'queuechange') {
      window.dispatchEvent(new Event('queuechange'));
    } else if (event.data === 'delivery-synced') {
      window.dispatchEvent(new Event('delivery-synced'));
    }
  };
}

export function broadcast(type) {
  try { channel?.postMessage(type); } catch {}
}

export const db = () => openDB('gauamrut-deliveries', 2, {
  upgrade(database, oldVersion) {
    if (oldVersion < 1) {
      database.createObjectStore('queue', { keyPath: 'key' });
    }
    if (oldVersion < 2) {
      database.createObjectStore('cache', { keyPath: 'key' });
    }
  }
});

export async function setCachedRoute(owner, path, data, meta) {
  if (!owner || !path) return;
  try {
    const database = await db();
    await database.put('cache', {
      key: `${owner}:${path}`,
      owner,
      path,
      data,
      meta,
      cachedAt: Date.now()
    });
  } catch {}
}

export async function getCachedRoute(owner, path) {
  if (!owner || !path) return null;
  try {
    const database = await db();
    return await database.get('cache', `${owner}:${path}`) || null;
  } catch {
    return null;
  }
}

export async function queued(owner) {
  return (await (await db()).getAll('queue')).filter(item => item.owner === owner);
}

export async function enqueue(owner, body, key) {
  await (await db()).put('queue', { owner, body, key, status: 'queued', createdAt: new Date().toISOString() });
  window.dispatchEvent(new Event('queuechange'));
  broadcast('queuechange');
}

let running = false;
export async function syncQueue(owner, onChange) {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    for (const item of await queued(owner)) {
      if (store.getState().session.user?.id !== owner || !store.getState().session.token) break;
      if (item.status === 'conflicted') continue;
      try {
        await (await db()).put('queue', { ...item, status: 'syncing' });
        onChange?.();
        const payload = {
          items: item.body.items.map(({ customer_id, date, shift, type, quantityMl }) => ({
            customer_id,
            date,
            shift,
            type,
            quantityMl
          }))
        };
        await api.post('/records/batch', payload, { headers: { 'Idempotency-Key': item.key } });
        await (await db()).delete('queue', item.key);
        window.dispatchEvent(new Event('delivery-synced'));
        broadcast('delivery-synced');
      } catch (error) {
        const conflict = error.response && error.response.status >= 400 && error.response.status < 500 && ![401, 429].includes(error.response.status);
        await (await db()).put('queue', { ...item, status: conflict ? 'conflicted' : 'queued', error: error.response?.data?.error?.message || 'Waiting for connection' });
        if (!conflict) break;
      }
      onChange?.();
      window.dispatchEvent(new Event('queuechange'));
      broadcast('queuechange');
    }
  } finally {
    running = false;
    onChange?.();
    window.dispatchEvent(new Event('queuechange'));
    broadcast('queuechange');
  }
}

export async function updateBatchItem(key, itemIndex, updatedFields) {
  const database = await db();
  const batch = await database.get('queue', key);
  if (!batch || !batch.body?.items?.[itemIndex]) return null;
  const items = [...batch.body.items];
  items[itemIndex] = { ...items[itemIndex], ...updatedFields };
  const updated = {
    ...batch,
    body: { ...batch.body, items },
    status: 'queued',
    error: undefined
  };
  await database.put('queue', updated);
  window.dispatchEvent(new Event('queuechange'));
  broadcast('queuechange');
  return updated;
}

export async function removeBatchItem(key, itemIndex) {
  const database = await db();
  const batch = await database.get('queue', key);
  if (!batch || !batch.body?.items) return;
  const items = batch.body.items.filter((_, idx) => idx !== itemIndex);
  if (items.length === 0) {
    await database.delete('queue', key);
  } else {
    await database.put('queue', {
      ...batch,
      body: { ...batch.body, items },
      status: 'queued',
      error: undefined
    });
  }
  window.dispatchEvent(new Event('queuechange'));
  broadcast('queuechange');
}

export async function saveBatchItems(key, items) {
  const database = await db();
  const batch = await database.get('queue', key);
  if (!batch) return;
  if (!items.length) {
    await database.delete('queue', key);
  } else {
    await database.put('queue', {
      ...batch,
      body: { ...batch.body, items },
      status: 'queued',
      error: undefined
    });
  }
  window.dispatchEvent(new Event('queuechange'));
  broadcast('queuechange');
}

export async function retryBatch(key, owner) {
  const database = await db();
  const batch = await database.get('queue', key);
  if (!batch) return;
  await database.put('queue', {
    ...batch,
    status: 'queued',
    error: undefined
  });
  window.dispatchEvent(new Event('queuechange'));
  broadcast('queuechange');
  if (owner) {
    syncQueue(owner);
  }
}

export async function discard(key) {
  await (await db()).delete('queue', key);
  window.dispatchEvent(new Event('queuechange'));
  broadcast('queuechange');
}



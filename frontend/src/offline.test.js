import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockStores = {
  queue: new Map(),
  cache: new Map()
};

const mockDb = {
  put: vi.fn(async (storeName, val) => {
    mockStores[storeName].set(val.key, JSON.parse(JSON.stringify(val)));
  }),
  get: vi.fn(async (storeName, key) => {
    const val = mockStores[storeName].get(key);
    return val ? JSON.parse(JSON.stringify(val)) : undefined;
  }),
  getAll: vi.fn(async (storeName) => {
    return Array.from(mockStores[storeName].values()).map(v => JSON.parse(JSON.stringify(v)));
  }),
  delete: vi.fn(async (storeName, key) => {
    mockStores[storeName].delete(key);
  })
};

vi.mock('idb', () => ({
  openDB: vi.fn(async () => mockDb)
}));

vi.mock('./lib', () => ({
  api: {
    post: vi.fn()
  },
  store: {
    getState: vi.fn(() => ({
      session: {
        user: { id: 'test-owner' },
        token: 'test-token'
      }
    }))
  }
}));

import {
  setCachedRoute,
  getCachedRoute,
  enqueue,
  queued,
  discard,
  updateBatchItem,
  removeBatchItem,
  saveBatchItems,
  retryBatch,
  syncQueue
} from './offline';
import { api } from './lib';

describe('Offline storage and conflict resolution', () => {
  beforeEach(() => {
    mockStores.queue.clear();
    mockStores.cache.clear();
    vi.clearAllMocks();
  });

  test('durable route caching saves and retrieves customer directory', async () => {
    const customers = [
      { _id: 'c1', name: 'Customer 1', morningCowMl: 1000 },
      { _id: 'c2', name: 'Customer 2', morningCowMl: 1500 }
    ];
    const meta = { total: 2 };

    await setCachedRoute('owner-1', '/customers?page=1&shift=morning', customers, meta);
    const cached = await getCachedRoute('owner-1', '/customers?page=1&shift=morning');

    expect(cached).not.toBeNull();
    expect(cached.data).toEqual(customers);
    expect(cached.meta).toEqual(meta);
    expect(cached.cachedAt).toBeGreaterThan(0);

    const nonExistent = await getCachedRoute('owner-1', '/customers?page=2');
    expect(nonExistent).toBeNull();
  });

  test('batch enqueuing, listing and discarding', async () => {
    const batchBody = {
      items: [
        { customer_id: 'c1', customerName: 'Customer 1', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 }
      ]
    };
    await enqueue('owner-1', batchBody, 'batch-key-1');

    const items = await queued('owner-1');
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('batch-key-1');
    expect(items[0].status).toBe('queued');

    await discard('batch-key-1');
    const afterDiscard = await queued('owner-1');
    expect(afterDiscard).toHaveLength(0);
  });

  test('updateBatchItem updates delivery quantity and resets status to queued', async () => {
    const batchKey = 'batch-key-2';
    await enqueue('owner-1', {
      items: [
        { customer_id: 'c1', customerName: 'Customer 1', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 }
      ]
    }, batchKey);

    // Simulate conflict
    const batch = await mockDb.get('queue', batchKey);
    batch.status = 'conflicted';
    batch.error = 'Quantity exceeds maximum limit';
    await mockDb.put('queue', batch);

    // Update quantity
    await updateBatchItem(batchKey, 0, { quantityMl: 1500 });

    const updated = await mockDb.get('queue', batchKey);
    expect(updated.status).toBe('queued');
    expect(updated.error).toBeUndefined();
    expect(updated.body.items[0].quantityMl).toBe(1500);
  });

  test('removeBatchItem removes item from batch and auto-discards if empty', async () => {
    const batchKey = 'batch-key-3';
    await enqueue('owner-1', {
      items: [
        { customer_id: 'c1', customerName: 'C1', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 },
        { customer_id: 'c2', customerName: 'C2', date: '2025-01-15', shift: 'morning', type: 'buffalo', quantityMl: 2000 }
      ]
    }, batchKey);

    // Remove first item
    await removeBatchItem(batchKey, 0);
    let batch = await mockDb.get('queue', batchKey);
    expect(batch.body.items).toHaveLength(1);
    expect(batch.body.items[0].customer_id).toBe('c2');

    // Remove remaining item
    await removeBatchItem(batchKey, 0);
    batch = await mockDb.get('queue', batchKey);
    expect(batch).toBeUndefined();
  });

  test('saveBatchItems updates all items and clears error', async () => {
    const batchKey = 'batch-key-4';
    await enqueue('owner-1', {
      items: [
        { customer_id: 'c1', customerName: 'C1', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 }
      ]
    }, batchKey);

    const newItems = [
      { customer_id: 'c1', customerName: 'C1', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 2000 },
      { customer_id: 'c3', customerName: 'C3', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 500 }
    ];

    await saveBatchItems(batchKey, newItems);
    const batch = await mockDb.get('queue', batchKey);
    expect(batch.body.items).toHaveLength(2);
    expect(batch.status).toBe('queued');
    expect(batch.error).toBeUndefined();
  });

  test('syncQueue strips presentation fields like customerName before API call', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    const batchKey = 'batch-sync-1';
    await enqueue('test-owner', {
      items: [
        { customer_id: '507f1f77bcf86cd799439011', customerName: 'Harshang', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 }
      ]
    }, batchKey);

    api.post.mockResolvedValueOnce({ data: { success: true } });

    await syncQueue('test-owner');

    expect(api.post).toHaveBeenCalledTimes(1);
    const postPayload = api.post.mock.calls[0][1];
    expect(postPayload).toEqual({
      items: [
        { customer_id: '507f1f77bcf86cd799439011', date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 }
      ]
    });
    expect(postPayload.items[0].customerName).toBeUndefined();

    const remaining = await queued('test-owner');
    expect(remaining).toHaveLength(0);
  });
});

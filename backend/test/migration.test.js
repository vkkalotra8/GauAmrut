const paymentReferenceMigration = require('../src/migrations/001-payment-reference-scope');

function connectionWith(rows, indexes = []) {
  const calls = { bulk: [], dropped: [], created: [] };
  const collection = {
    find: () => ({ toArray: async () => rows }),
    bulkWrite: async operations => calls.bulk.push(...operations),
    indexes: async () => indexes,
    dropIndex: async name => calls.dropped.push(name),
    createIndex: async (keys, options) => calls.created.push({ keys, options })
  };
  const cursor = { hasNext: async () => true };
  return {
    connection: {
      collection: () => collection,
      db: { listCollections: () => cursor }
    },
    calls
  };
}

describe('payment reference migration', () => {
  test('dry run detects case-insensitive duplicates within one tenant', async () => {
    const { connection } = connectionWith([
      { _id: 'a', milkman_id: 'tenant-a', reference: 'utr-1' },
      { _id: 'b', milkman_id: 'tenant-a', reference: 'UTR-1' }
    ]);
    await expect(paymentReferenceMigration.up({ connection, dryRun: true })).rejects.toMatchObject({ code: 'PAYMENT_REFERENCE_COLLISIONS' });
  });

  test('allows the same canonical reference in different tenants and replaces the legacy index', async () => {
    const { connection, calls } = connectionWith([
      { _id: 'a', milkman_id: 'tenant-a', reference: 'utr-1' },
      { _id: 'b', milkman_id: 'tenant-b', reference: 'UTR-1' }
    ], [{ name: 'reference_1' }]);
    const result = await paymentReferenceMigration.up({ connection });
    expect(result.updated).toBe(2);
    expect(calls.dropped).toEqual(['reference_1']);
    expect(calls.created[0].keys).toEqual({ milkman_id: 1, referenceCanonical: 1 });
  });
});

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ensurePaymentsNamespace = require('../src/migrations/000-ensure-payments-namespace');
const { migrations } = require('../src/migrations');

function connectionWith({
  exists = false,
  hasNextError,
  closeError,
  createError,
} = {}) {
  const cursor = {
    hasNext: jest.fn(async () => {
      if (hasNextError) throw hasNextError;
      return exists;
    }),
    close: jest.fn(async () => {
      if (closeError) throw closeError;
    }),
  };
  const db = {
    listCollections: jest.fn(() => cursor),
    createCollection: jest.fn(async () => {
      if (createError) throw createError;
    }),
  };

  return { connection: { db }, db, cursor };
}

describe('ensure payments namespace migration', () => {
  test('creates a missing payments collection and closes the cursor', async () => {
    const { connection, db, cursor } = connectionWith();

    await expect(ensurePaymentsNamespace.up({ connection })).resolves.toEqual({
      created: true,
      alreadyExists: false,
    });
    expect(db.listCollections).toHaveBeenCalledWith(
      { name: 'payments' },
      { nameOnly: true }
    );
    expect(db.createCollection).toHaveBeenCalledWith('payments');
    expect(cursor.close).toHaveBeenCalledTimes(1);
  });

  test('does nothing when payments already exists', async () => {
    const { connection, db, cursor } = connectionWith({ exists: true });

    await expect(ensurePaymentsNamespace.up({ connection })).resolves.toEqual({
      created: false,
      alreadyExists: true,
    });
    expect(db.createCollection).not.toHaveBeenCalled();
    expect(cursor.close).toHaveBeenCalledTimes(1);
  });

  test('dry-run does not create a missing collection', async () => {
    const { connection, db, cursor } = connectionWith();

    await expect(
      ensurePaymentsNamespace.up({ connection, dryRun: true })
    ).resolves.toEqual({
      created: false,
      wouldCreate: true,
    });
    expect(db.createCollection).not.toHaveBeenCalled();
    expect(cursor.close).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['NamespaceExists', { codeName: 'NamespaceExists' }],
    ['code 48', { code: 48 }],
  ])('tolerates a harmless creation race reported as %s', async (_label, createError) => {
    const { connection, cursor } = connectionWith({ createError });

    await expect(ensurePaymentsNamespace.up({ connection })).resolves.toEqual({
      created: false,
      alreadyExists: true,
    });
    expect(cursor.close).toHaveBeenCalledTimes(1);
  });

  test('propagates unexpected creation errors', async () => {
    const createError = new Error('create failed');
    const { connection, cursor } = connectionWith({ createError });

    await expect(ensurePaymentsNamespace.up({ connection })).rejects.toBe(
      createError
    );
    expect(cursor.close).toHaveBeenCalledTimes(1);
  });

  test('closes the cursor when collection inspection fails', async () => {
    const hasNextError = new Error('inspection failed');
    const { connection, db, cursor } = connectionWith({ hasNextError });

    await expect(ensurePaymentsNamespace.up({ connection })).rejects.toBe(
      hasNextError
    );
    expect(cursor.close).toHaveBeenCalledTimes(1);
    expect(db.createCollection).not.toHaveBeenCalled();
  });
});

describe('migration registry', () => {
  test('registers namespace setup before payment reference scoping', () => {
    expect(migrations.map(migration => migration.name)).toEqual([
      '000-ensure-payments-namespace',
      '001-payment-reference-scope',
    ]);
  });

  test('preserves the exact runtime checksum for migration 001', () => {
    const migration = migrations.find(
      item => item.name === '001-payment-reference-scope'
    );
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../src/migrations/001-payment-reference-scope.js'
      ),
      'utf8'
    );
    const sandbox = { module: { exports: {} }, exports: {} };
    vm.runInNewContext(source, sandbox);
    const runtimeChecksum = crypto
      .createHash('sha256')
      .update(sandbox.module.exports.up.toString())
      .digest('hex');

    expect(runtimeChecksum).toBe(
      'fb094828c375da335de8cc0d7695fde089bdf8a76cd30595f3fa8356a457694e'
    );
    expect(
      crypto
        .createHash('sha256')
        .update(migration.up.toString())
        .digest('hex')
    ).toBe(migration.checksum);
  });
});

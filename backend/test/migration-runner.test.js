const mockMigrations = [];
const mockCollection = jest.fn();

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongoose', () => ({
  connection: {
    collection: (...args) => mockCollection(...args),
  },
}));
jest.mock('../src/migrations', () => ({ migrations: mockMigrations }));

const {
  pendingMigrations,
  runMigrations,
} = require('../src/migration-runner');

function historyWith(applied = []) {
  const history = {
    find: jest.fn(() => ({
      toArray: jest.fn(async () => applied),
    })),
    insertOne: jest.fn(async () => undefined),
  };
  mockCollection.mockReturnValue(history);
  return history;
}

function migration(name, checksum, implementation = async () => ({})) {
  return {
    name,
    checksum,
    up: jest.fn(implementation),
  };
}

beforeEach(() => {
  mockMigrations.splice(0);
  mockCollection.mockReset();
});

describe('migration runner', () => {
  test('skips an already-applied migration with the same checksum', async () => {
    const applied = migration('001', 'checksum-1');
    mockMigrations.push(applied);
    historyWith([{ name: '001', checksum: 'checksum-1' }]);

    await expect(runMigrations()).resolves.toEqual([]);
    expect(applied.up).not.toHaveBeenCalled();
  });

  test('rejects a modified applied migration', async () => {
    const modified = migration('001', 'new-checksum');
    mockMigrations.push(modified);
    historyWith([{ name: '001', checksum: 'old-checksum' }]);

    await expect(pendingMigrations()).rejects.toThrow(
      'Applied migration 001 has changed checksum.'
    );
    expect(modified.up).not.toHaveBeenCalled();
  });

  test('runs only pending migrations and records successful execution', async () => {
    const applied = migration('000', 'checksum-0');
    const pending = migration('001', 'checksum-1', async () => ({
      updated: 2,
    }));
    mockMigrations.push(applied, pending);
    const history = historyWith([
      { name: '000', checksum: 'checksum-0' },
    ]);

    await expect(runMigrations()).resolves.toEqual([
      { name: '001', updated: 2 },
    ]);
    expect(applied.up).not.toHaveBeenCalled();
    expect(pending.up).toHaveBeenCalledWith({
      connection: expect.any(Object),
      dryRun: false,
    });
    expect(history.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '001',
        checksum: 'checksum-1',
        appliedAt: expect.any(Date),
        executionMs: expect.any(Number),
      })
    );
  });

  test('does not write migration history during dry-run', async () => {
    const pending = migration('000', 'checksum-0', async () => ({
      wouldCreate: true,
    }));
    mockMigrations.push(pending);
    const history = historyWith();

    await expect(runMigrations({ dryRun: true })).resolves.toEqual([
      { name: '000', wouldCreate: true },
    ]);
    expect(pending.up).toHaveBeenCalledWith({
      connection: expect.any(Object),
      dryRun: true,
    });
    expect(history.insertOne).not.toHaveBeenCalled();
  });

  test('does not record a migration when execution fails', async () => {
    const failure = new Error('migration failed');
    const pending = migration('000', 'checksum-0', async () => {
      throw failure;
    });
    mockMigrations.push(pending);
    const history = historyWith();

    await expect(runMigrations()).rejects.toBe(failure);
    expect(history.insertOne).not.toHaveBeenCalled();
  });
});

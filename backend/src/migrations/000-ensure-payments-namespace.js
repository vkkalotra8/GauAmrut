
const name = '000-ensure-payments-namespace';

async function up({ connection, dryRun = false }) {
  const cursor = connection.db.listCollections(
    { name: 'payments' },
    { nameOnly: true }
  );

  let exists;

  try {
    exists = await cursor.hasNext();
  } finally {
    await cursor.close();
  }

  if (exists) {
    return { created: false, alreadyExists: true };
  }

  if (dryRun) {
    return { created: false, wouldCreate: true };
  }

  try {
    await connection.db.createCollection('payments');
    return { created: true, alreadyExists: false };
  } catch (error) {
    if (error.codeName === 'NamespaceExists' || error.code === 48) {
      return { created: false, alreadyExists: true };
    }
    throw error;
  }
}

module.exports = { name, up };

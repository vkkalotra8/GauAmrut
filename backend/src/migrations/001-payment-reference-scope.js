const name = '001-payment-reference-scope';

async function up({ connection, dryRun = false }) {
  const payments = connection.collection('payments');
  const rows = await payments.find({ reference: { $type: 'string', $ne: '' } }, { projection: { milkman_id: 1, reference: 1, referenceCanonical: 1 } }).toArray();
  const seen = new Map();
  const collisions = [];
  for (const row of rows) {
    const canonical = row.reference.trim().toUpperCase();
    const key = `${row.milkman_id}:${canonical}`;
    if (seen.has(key)) collisions.push({ milkman_id: String(row.milkman_id), referenceCanonical: canonical, ids: [seen.get(key), String(row._id)] });
    else seen.set(key, String(row._id));
  }
  if (collisions.length) {
    const error = new Error(`Payment reference migration blocked by ${collisions.length} tenant-scoped duplicate(s). Resolve the reported records before retrying.`);
    error.code = 'PAYMENT_REFERENCE_COLLISIONS';
    error.details = collisions;
    throw error;
  }
  const changed = rows.filter(row => row.referenceCanonical !== row.reference.trim().toUpperCase());
  if (dryRun) return { scanned: rows.length, updated: changed.length, collisions: [] };
  if (changed.length) await payments.bulkWrite(changed.map(row => ({ updateOne: { filter: { _id: row._id }, update: { $set: { referenceCanonical: row.reference.trim().toUpperCase() } } } })), { ordered: false });
  const collectionExists = await connection.db
  .listCollections({ name: 'payments' }, { nameOnly: true })
  .hasNext();

const indexes = collectionExists ? await payments.indexes() : [];
  const legacy = indexes.find(index => index.name === 'reference_1');
  if (legacy) await payments.dropIndex(legacy.name);
  await payments.createIndex({ milkman_id: 1, referenceCanonical: 1 }, { name: 'milkman_id_1_referenceCanonical_1', unique: true, partialFilterExpression: { referenceCanonical: { $type: 'string' } } });
  return { scanned: rows.length, updated: changed.length, droppedLegacyIndex: Boolean(legacy) };
}

module.exports = { name, up };

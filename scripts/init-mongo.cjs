const { MongoClient } = require('../backend/node_modules/mongodb');
async function main() {
  const client = new MongoClient('mongodb://127.0.0.1:27018/?directConnection=true', { serverSelectionTimeoutMS: 2000 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await client.connect(); break; }
      catch (e) { if (attempt >= 20) throw e; await new Promise(r => setTimeout(r, 500)); }
    }
    const admin = client.db('admin');
    try { await admin.command({ replSetInitiate: { _id: 'gauamrut-rs', members: [{ _id: 0, host: '127.0.0.1:27018' }] } }); }
    catch (e) { if (e.codeName !== 'AlreadyInitialized') throw e; }
    for (let attempt = 0; attempt < 40; attempt++) {
      const hello = await admin.command({ hello: 1 });
      if (hello.setName !== 'gauamrut-rs') throw new Error('Port 27018 belongs to a different replica set. No configuration was changed.');
      if (hello.isWritablePrimary) { console.log('GauAmrut replica set ready on 127.0.0.1:27018.'); return; }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Replica set did not elect a primary.');
  } finally { await client.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });

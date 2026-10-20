const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execSync } = require('node:child_process');

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function findMongod() {
  const paths = [
    'mongod',
    'D:\\MongoDB\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe'
  ];
  for (const p of paths) {
    try {
      execSync(`"${p}" --version`, { stdio: 'ignore' });
      return p;
    } catch {}
  }
  return 'mongod';
}

async function ensureLocalMongo() {
  const mongoUri = process.env.MONGO_URI || '';
  // Skip if in production or pointing to a remote Mongo cluster (like Atlas)
  if (
    process.env.NODE_ENV === 'production' ||
    (mongoUri && !mongoUri.includes('127.0.0.1:27018') && !mongoUri.includes('localhost:27018'))
  ) {
    return null;
  }

  const port = 27018;
  if (await isPortOpen(port)) {
    return null;
  }

  const mongoDir = path.resolve(__dirname, '../../.local/mongodb');
  fs.mkdirSync(mongoDir, { recursive: true });
  const logPath = path.join(mongoDir, 'mongod.log');
  const mongodBin = findMongod();

  console.log(`Starting local MongoDB replica set (gauamrut-rs) on 127.0.0.1:${port}...`);
  const child = spawn(mongodBin, [
    '--replSet', 'gauamrut-rs',
    '--bind_ip', '127.0.0.1',
    '--port', String(port),
    '--dbpath', mongoDir,
    '--logpath', logPath,
    '--logappend'
  ], {
    stdio: 'ignore'
  });

  child.on('error', (err) => {
    console.error('Failed to spawn mongod:', err.message);
  });

  let started = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isPortOpen(port)) {
      started = true;
      break;
    }
  }

  if (!started) {
    throw new Error(`Failed to start mongod on port ${port}. Please inspect log at ${logPath}`);
  }

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const admin = client.db('admin');
    try {
      await admin.command({ replSetInitiate: { _id: 'gauamrut-rs', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    } catch (e) {
      if (e.codeName !== 'AlreadyInitialized') {
        // Can throw during transition to primary, handled in loop below
      }
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const hello = await admin.command({ hello: 1 });
        if (hello.isWritablePrimary) {
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    try { await client.close(); } catch {}
  }

  console.log(`Local MongoDB replica set is ready on 127.0.0.1:${port}.`);
  return child;
}

module.exports = {
  isPortOpen,
  ensureLocalMongo
};

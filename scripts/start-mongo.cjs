const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });
const { ensureLocalMongo } = require('../backend/src/local-mongo');

async function main() {
  try {
    const child = await ensureLocalMongo();
    if (child) {
      console.log('MongoDB process started with PID:', child.pid);
      child.unref();
    } else {
      console.log('MongoDB replica set is already running on port 27018.');
    }
  } catch (err) {
    console.error('Failed to start MongoDB:', err.message);
    process.exit(1);
  }
}

main();

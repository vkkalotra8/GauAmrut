require('dotenv').config();
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
const root = path.resolve(process.argv[2] || path.join(process.cwd(), 'backups'));
fs.mkdirSync(root, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archive = path.join(root, `gauamrut-${stamp}.archive.gz`);
const result = spawnSync(process.platform === 'win32' ? 'mongodump.exe' : 'mongodump', [`--uri=${process.env.MONGO_URI}`, `--archive=${archive}`, '--gzip'], { stdio: 'inherit', shell: false });
if (result.error?.code === 'ENOENT') throw new Error('mongodump is not installed. Install MongoDB Database Tools.');
if (result.status !== 0) process.exit(result.status || 1);
const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const manifest = { createdAt: new Date().toISOString(), archive: path.basename(archive), bytes: fs.statSync(archive).size, sha256: checksum };
fs.writeFileSync(`${archive}.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ success: true, ...manifest }));

require('dotenv').config();
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const archiveArg = process.argv.find(arg => arg.endsWith('.archive.gz'));
if (!process.env.MONGO_URI || !archiveArg) throw new Error('Usage: npm run restore -- <backup.archive.gz> --confirm (MONGO_URI must target the restore environment).');
if (!process.argv.includes('--confirm')) throw new Error('Restore is destructive. Re-run with --confirm after verifying MONGO_URI targets the intended restore environment.');
const archive = path.resolve(archiveArg);
const manifestPath = `${archive}.json`;
if (!fs.existsSync(archive) || !fs.existsSync(manifestPath)) throw new Error('Backup archive and its .json manifest are both required.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (checksum !== manifest.sha256) throw new Error('Backup checksum does not match its manifest.');
const result = spawnSync(process.platform === 'win32' ? 'mongorestore.exe' : 'mongorestore', [`--uri=${process.env.MONGO_URI}`, `--archive=${archive}`, '--gzip', '--drop'], { stdio: 'inherit', shell: false });
if (result.error?.code === 'ENOENT') throw new Error('mongorestore is not installed. Install MongoDB Database Tools.');
if (result.status !== 0) process.exit(result.status || 1);
console.log(JSON.stringify({ success: true, restored: manifest.archive, verifiedSha256: checksum }));

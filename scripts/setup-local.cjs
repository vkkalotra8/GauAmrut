const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
for (const workspace of ['backend', 'frontend']) {
  const target = path.join(root, workspace, '.env');
  if (fs.existsSync(target)) { console.log(`${workspace}/.env already exists; preserved.`); continue; }
  let content = fs.readFileSync(path.join(root, workspace, '.env.example'), 'utf8');
  if (workspace === 'backend') content = content.replace('replace-with-a-random-secret-of-at-least-32-characters', crypto.randomBytes(48).toString('hex'));
  fs.writeFileSync(target, content, { flag: 'wx' });
  console.log(`Created ${workspace}/.env.`);
}

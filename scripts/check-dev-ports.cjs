const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('../backend/node_modules/dotenv');
const envPath = path.join(__dirname, '../backend/.env');
const config = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const apiPort = Number(process.env.PORT || config.PORT || 4000);
function check(port, name) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE'
      ? `${name} port ${port} is already in use. Stop existing GauAmrut servers with Ctrl+C before running npm run dev:all. To run separately, use npm start in backend and npm run dev in frontend. No new servers were started.`
      : `Cannot use ${name} port ${port}: ${error.code || error.message}`)));
    probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => probe.close(resolve));
  });
}
async function main() {
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('Backend PORT must be an integer between 1 and 65535.');
  await check(apiPort, 'API');
  await check(5173, 'Frontend');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

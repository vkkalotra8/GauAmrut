const base = String(process.env.STAGING_API_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(base)) throw new Error('STAGING_API_URL must be an HTTPS API base, for example https://api-staging.example.com/api');
async function check(path, expected = 200) {
  const started = Date.now();
  const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status !== expected) throw new Error(`${path} returned ${response.status}, expected ${expected}`);
  console.log(JSON.stringify({ path, status: response.status, durationMs: Date.now() - started }));
  return response;
}
(async () => {
  const health = await (await check('/health')).json();
  if (!health.success || health.data?.status !== 'ready') throw new Error('Staging health response is not ready.');
  await check('/platform/settings');
  await check('/dashboard', 401);
  console.log(JSON.stringify({ success: true, stagingApi: base }));
})().catch(error => { console.error(error.message); process.exit(1); });

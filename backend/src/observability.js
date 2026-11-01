const metrics = {
  startedAt: Date.now(), requests: 0, errors: 0, latencyMsTotal: 0,
  status: new Map(), routes: new Map(), billingRuns: 0, billingFailures: 0
};

function count(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function observeRequests(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    metrics.requests += 1; metrics.latencyMsTotal += elapsed;
    if (res.statusCode >= 500) metrics.errors += 1;
    count(metrics.status, String(res.statusCode));
    count(metrics.routes, `${req.method} ${req.route?.path || req.path}`);
    console.log(JSON.stringify({ event: 'http_request', requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(elapsed * 100) / 100 }));
  });
  next();
}
function billingRun(failed = false) { metrics.billingRuns += 1; if (failed) metrics.billingFailures += 1; }
function prometheus() {
  const lines = [
    '# HELP gauamrut_uptime_seconds Process uptime.', '# TYPE gauamrut_uptime_seconds gauge', `gauamrut_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
    '# HELP gauamrut_http_requests_total HTTP requests.', '# TYPE gauamrut_http_requests_total counter', `gauamrut_http_requests_total ${metrics.requests}`,
    '# HELP gauamrut_http_errors_total HTTP 5xx responses.', '# TYPE gauamrut_http_errors_total counter', `gauamrut_http_errors_total ${metrics.errors}`,
    '# HELP gauamrut_http_latency_ms_total Accumulated HTTP latency.', '# TYPE gauamrut_http_latency_ms_total counter', `gauamrut_http_latency_ms_total ${metrics.latencyMsTotal.toFixed(3)}`,
    '# HELP gauamrut_billing_runs_total Monthly billing runs.', '# TYPE gauamrut_billing_runs_total counter', `gauamrut_billing_runs_total ${metrics.billingRuns}`,
    '# HELP gauamrut_billing_failures_total Failed monthly billing runs.', '# TYPE gauamrut_billing_failures_total counter', `gauamrut_billing_failures_total ${metrics.billingFailures}`
  ];
  for (const [status, value] of metrics.status) lines.push(`gauamrut_http_status_total{status="${status}"} ${value}`);
  return lines.join('\n') + '\n';
}
function metricsEndpoint(req, res) {
  const token = process.env.METRICS_TOKEN;
  const supplied = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token || supplied !== token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Metrics token is required.' } });
  res.type('text/plain; version=0.0.4').send(prometheus());
}
module.exports = { observeRequests, metricsEndpoint, billingRun, prometheus };

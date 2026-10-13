#!/usr/bin/env node
// End-to-end load test through the deployed gateway (browser → Worker → GAS → Sheets).
// Refuses to run unless /health reports DEMO: never load-test a workbook holding real data.
//
//   BASE_URL=https://ltc-demo.example.org ACCOUNTS="load.cg.1:pass,load.cg.2:pass" node scripts/load-test/run.mjs
//
// Environment:
//   BASE_URL          gateway origin (required)
//   ACCOUNTS          comma-separated identifier:password pairs for CG accounts (from seedLoadTestData)
//   DEMO_ROLE         instead of ACCOUNTS, impersonate this role (wrangler dev on localhost only)
//   CONCURRENCY       parallel virtual users (default 5)
//   DURATION_SECONDS  test length (default 60)
//   SUBMIT_RATIO      share of iterations that also submit a visit (default 0.2)
//   MAX_P95_MS        fail if any endpoint's p95 exceeds this (default 5000)
//   MAX_ERROR_RATE    fail if the share of failed requests exceeds this (default 0.01)

const env = process.env;
const baseUrl = (env.BASE_URL ?? '').replace(/\/$/, '');
const concurrency = Number(env.CONCURRENCY ?? 5);
const durationMs = Number(env.DURATION_SECONDS ?? 60) * 1000;
const submitRatio = Number(env.SUBMIT_RATIO ?? 0.2);
const maxP95 = Number(env.MAX_P95_MS ?? 5000);
const maxErrorRate = Number(env.MAX_ERROR_RATE ?? 0.01);

if (!baseUrl) {
  console.error('BASE_URL is required. See the header of this file for usage.');
  process.exit(2);
}

const origin = new URL(baseUrl).origin;
const samples = new Map(); // label -> { latencies: number[], failures: Map<string, number> }

function record(label, latency, failure) {
  const entry = samples.get(label) ?? { latencies: [], failures: new Map() };
  entry.latencies.push(latency);
  if (failure) entry.failures.set(failure, (entry.failures.get(failure) ?? 0) + 1);
  samples.set(label, entry);
}

async function request(label, path, { method = 'GET', body, identity } = {}) {
  const headers = { 'content-type': 'application/json', 'x-ltc-request': '1', origin };
  if (identity?.cookie) headers.cookie = identity.cookie;
  if (identity?.demoRole) headers['x-demo-role'] = identity.demoRole;
  const started = performance.now();
  let failure = null;
  let envelope = null;
  let response = null;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    envelope = await response.json().catch(() => null);
    if (!response.ok || !envelope?.ok) failure = `${response.status} ${envelope?.code ?? 'NON_JSON'}`;
  } catch (error) {
    failure = `NETWORK ${error.cause?.code ?? error.message}`;
  }
  if (label) record(label, performance.now() - started, failure);
  return { response, envelope, failure };
}

async function signIn() {
  if (env.DEMO_ROLE) return Array.from({ length: concurrency }, () => ({ name: `demo-${env.DEMO_ROLE}`, demoRole: env.DEMO_ROLE }));
  const accounts = (env.ACCOUNTS ?? '').split(',').map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const separator = pair.indexOf(':');
    return { identifier: pair.slice(0, separator), password: pair.slice(separator + 1) };
  });
  if (accounts.length === 0) throw new Error('Set ACCOUNTS (identifier:password,...) or DEMO_ROLE.');
  const identities = [];
  for (const account of accounts) {
    const { response, failure } = await request(null, '/auth/password/login', { method: 'POST', body: account });
    if (failure) throw new Error(`Sign-in failed for ${account.identifier}: ${failure}`);
    const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('__Host-ltc_session='));
    identities.push({ name: account.identifier, cookie });
  }
  return identities;
}

async function virtualUser(identity, deadline) {
  while (Date.now() < deadline) {
    await request('GET /dashboard', '/dashboard', { identity });
    const { envelope } = await request('GET /visits', '/visits', { identity });
    const open = (envelope?.data?.items ?? []).filter((visit) => visit.status === 'ASSIGNED');
    if (open.length > 0 && Math.random() < submitRatio) {
      const visit = open[Math.floor(Math.random() * open.length)];
      await request('POST /visit-encounters', '/visit-encounters', {
        method: 'POST', identity,
        body: { visitId: visit.visitId, submissionId: crypto.randomUUID(), source: 'ONLINE', startedAt: '09:00', endedAt: '10:00', activityCompleted: true, urgentFlag: false, notes: 'load test', vitals: {} }
      });
    }
  }
}

const percentile = (sorted, fraction) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] : 0;

async function main() {
  const health = await request(null, '/health');
  if (health.envelope?.data?.mode !== 'DEMO') {
    console.error(`Refusing to run: ${baseUrl} reports mode ${health.envelope?.data?.mode ?? health.failure}. Load tests run against DEMO only.`);
    process.exit(2);
  }
  const identities = await signIn();
  console.log(`Running ${concurrency} virtual users for ${durationMs / 1000}s against ${baseUrl} as ${[...new Set(identities.map((identity) => identity.name))].join(', ')}`);
  const deadline = Date.now() + durationMs;
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, (_, index) => virtualUser(identities[index % identities.length], deadline)));
  const elapsedSeconds = (Date.now() - started) / 1000;

  let total = 0;
  let failed = 0;
  let slowest = 0;
  const table = [...samples].map(([label, { latencies, failures }]) => {
    const sorted = [...latencies].sort((left, right) => left - right);
    const failureCount = [...failures.values()].reduce((sum, count) => sum + count, 0);
    total += sorted.length;
    failed += failureCount;
    slowest = Math.max(slowest, percentile(sorted, 0.95));
    return {
      endpoint: label, requests: sorted.length, 'req/s': +(sorted.length / elapsedSeconds).toFixed(2),
      p50: Math.round(percentile(sorted, 0.5)), p95: Math.round(percentile(sorted, 0.95)), p99: Math.round(percentile(sorted, 0.99)), max: Math.round(sorted.at(-1) ?? 0),
      errors: failureCount, 'error kinds': [...failures].map(([kind, count]) => `${kind} ×${count}`).join('; ')
    };
  });
  console.table(table);
  const errorRate = total ? failed / total : 1;
  console.log(`Total ${total} requests, ${(errorRate * 100).toFixed(2)}% failed, worst p95 ${Math.round(slowest)} ms (limits: p95 ≤ ${maxP95} ms, errors ≤ ${(maxErrorRate * 100).toFixed(2)}%)`);
  if (slowest > maxP95 || errorRate > maxErrorRate) {
    console.error('FAIL: thresholds exceeded');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});

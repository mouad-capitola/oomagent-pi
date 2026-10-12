import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { parseQuota, formatQuota, formatContext, fetchQuota, createQuotaMonitor } from "../.pi/lib/footer-limits.ts";

const data = { rate_limit: {
  primary_window: { used_percent: 42, limit_window_seconds: 18000 },
  secondary_window: { used_percent: 17, limit_window_seconds: 604800 },
} };
const ctx = (provider = "openai-codex") => ({
  mode: "tui", hasUI: true, model: { provider },
  modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-only" }) },
});

test("quota windows remain distinct; invalid or expired usage is unknown, not zero", () => {
  assert.deepEqual(parseQuota(data), { fiveHour: 42, weekly: 17 });
  assert.equal(formatQuota(parseQuota(data)), "ChatGPT week 17%");
  for (const used_percent of [-1, 101, NaN, Infinity, "42", null]) {
    assert.deepEqual(parseQuota({ rate_limit: { primary_window: { used_percent, limit_window_seconds: 18000 } } }), {});
  }
  assert.deepEqual(parseQuota({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 10 } } }, 11000), {});
  assert.doesNotMatch(formatQuota(parseQuota(data)), /5h/);
  assert.equal(formatQuota(), "ChatGPT week ?%");
  assert.equal(formatQuota({ fiveHour: 0, weekly: 100 }), "ChatGPT week 100%");
  for (const value of [null, undefined, [], "invalid", {}]) assert.deepEqual(parseQuota(value), {});
});

test("context percentage and actual capacity come from Pi, never a hardcoded 272k", () => {
  assert.equal(formatContext({ getContextUsage: () => ({ percent: 25, contextWindow: 272000 }) }), "CTX 25.0% / 272k");
  assert.equal(formatContext({ getContextUsage: () => ({ percent: null, contextWindow: 200000 }) }), "CTX ?% / 200k");
  assert.equal(formatContext({ model: { contextWindow: 272000 } }), "CTX ?% / 272k");
  assert.equal(formatContext({}), "CTX ?% / ?");
  assert.equal(formatContext({ getContextUsage: () => ({ percent: 110, contextWindow: -1 }) }), "CTX 100.0% / ?");
});

test("fixed HTTPS endpoint, no redirects, bounded JSON and no credential access for other models", async () => {
  let calls = 0;
  const fetch = mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    assert.ok(options.signal);
    return Response.json(data);
  });
  try {
    assert.deepEqual(await fetchQuota(ctx(), new AbortController().signal), { fiveHour: 42, weekly: 17 });
    const other = ctx("anthropic");
    other.modelRegistry.getApiKeyAndHeaders = () => assert.fail("must not request auth");
    assert.equal(await fetchQuota(other, new AbortController().signal), undefined);
    assert.equal(calls, 1);
    fetch.mock.mockImplementation(async () => new Response("x".repeat(65537)));
    assert.equal(await fetchQuota(ctx(), new AbortController().signal), undefined);
    fetch.mock.mockImplementation(async () => new Response("denied", { status: 401 }));
    assert.equal(await fetchQuota(ctx(), new AbortController().signal), undefined);
    fetch.mock.mockImplementation(async () => new Response("invalid JSON"));
    await assert.rejects(fetchQuota(ctx(), new AbortController().signal));
  } finally { fetch.mock.restore(); }
});

test("monitor throttles, discards failed/stale results and clears timer on stop", async () => {
  let now = 0, calls = 0;
  let fail = false;
  const monitor = createQuotaMonitor(() => {}, async () => {
    calls++;
    if (fail) throw new Error("private error must not be logged");
    return { weekly: 17 };
  }, () => now);
  try {
    monitor.start(ctx());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.deepEqual(monitor.snapshot(), { weekly: 17 });
    await monitor.refresh(); assert.equal(calls, 1);
    now = 60000; fail = true;
    await monitor.refresh(); assert.equal(calls, 2);
    assert.equal(monitor.snapshot(), undefined);
    now = 120000; fail = false;
    await monitor.refresh();
    now = 240001;
    assert.equal(monitor.snapshot(), undefined);
    monitor.stop(); await monitor.refresh(); assert.equal(calls, 3);
  } finally { monitor.stop(); }
});

test("late responses cannot revive quota after model switch or shutdown", async () => {
  let finish;
  let signal;
  const monitor = createQuotaMonitor(() => {}, async (_ctx, requestSignal) => {
    signal = requestSignal;
    return new Promise(resolve => { finish = resolve; });
  });
  monitor.start(ctx());
  monitor.start(ctx("anthropic"));
  assert.ok(signal.aborted);
  finish({ weekly: 99 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(monitor.snapshot(), undefined);
  monitor.stop();
});

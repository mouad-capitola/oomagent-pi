import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { readFile } from "node:fs/promises";

// Exercise the full registered tool with mocked Keychain, HTTP and summaries.
// No real credentials, subprocesses or external API requests are used.
const deps = {};
globalThis.__webSearchTest = deps;
const source = (await readFile(new URL("../.pi/extensions/web-search.ts", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replace("const keychainCommand = promisify(execFile);", "");
const prelude = `
const deps = globalThis.__webSearchTest;
const Type = Object.fromEntries(["Object", "String", "Optional", "Integer", "Boolean"].map(name => [name, value => value]));
const defineTool = value => value;
const keychainCommand = (...args) => deps.keychain(...args);
const fetch = (...args) => deps.fetch(...args);
const summarizePages = (...args) => deps.summarize(...args);
`;
const module = await import(`data:text/javascript;base64,${Buffer.from(prelude + stripTypeScriptTypes(source)).toString("base64")}`);
delete globalThis.__webSearchTest;
let tool;
module.default({ registerTool(value) { tool = value; } });

const fakeKey = "test-only-exa-secret";
const row = (url = "https://nodejs.org/docs", extra = {}) => ({ url, title: "Node.js", highlights: ["Documentation"], ...extra });
const jsonResponse = payload => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });

function fixture() {
  const calls = { keychain: [], fetch: [], summaries: [] };
  deps.keychain = async (...args) => { calls.keychain.push(args); return { stdout: fakeKey + "\n" }; };
  deps.fetch = async (...args) => { calls.fetch.push(args); return jsonResponse({ results: [row()] }); };
  deps.summarize = async (...args) => { calls.summaries.push(args); return { method: "extractive", pageCount: args[0].length }; };
  return calls;
}
const execute = (args = {}, signal) => tool.execute("test", { query: "Node.js docs", ...args }, signal);

await test("Exa POST uses Keychain service exa and never returns the key", async () => {
  const calls = fixture();
  assert.equal(calls.keychain.length, 0);
  const result = await execute({ query: " Node.js docs " });
  const [command, args, options] = calls.keychain[0];
  assert.equal(command, "/usr/bin/security");
  assert.deepEqual(args, ["find-generic-password", "-w", "-s", "exa"]);
  assert.equal(options.timeout, 10000);
  assert.equal(options.maxBuffer, 16384);
  assert.ok(options.signal instanceof AbortSignal);
  const [url, request] = calls.fetch[0];
  assert.equal(url, "https://api.exa.ai/search");
  assert.equal(request.method, "POST");
  assert.equal(request.redirect, "error");
  assert.equal(request.headers["x-api-key"], fakeKey);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.body), {
    query: "Node.js docs", type: "auto", numResults: 5,
    contents: { highlights: { numSentences: 3, highlightsPerUrl: 1 } },
  });
  assert.equal(result.details.provider, "Exa");
  assert.equal(result.details.effectiveQuery, "Node.js docs");
  assert.equal(result.details.results[0].snippet, "Documentation");
  assert.match(result.content[0].text, /Untrusted/);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
  assert.equal(calls.summaries.length, 0);
});

await test("website filter includes subdomains, excludes lookalikes and preserves summary options", async () => {
  const calls = fixture();
  deps.fetch = async (...args) => {
    calls.fetch.push(args);
    return jsonResponse({ results: [row(), row("https://api.nodejs.org/docs"), row("https://evilnodejs.org/")] });
  };
  const result = await execute({ website: " NODEJS.ORG. ", max_results: 3, summarize: true, max_pages: 1, max_sentences: 2 });
  const body = JSON.parse(calls.fetch[0][1].body);
  assert.deepEqual(body.includeDomains, ["nodejs.org"]);
  assert.equal(body.numResults, 3);
  assert.equal(result.details.resultCount, 2);
  assert.equal(result.details.website, "nodejs.org");
  assert.deepEqual(calls.summaries[0].slice(0, 2), [["https://nodejs.org/docs"], 2]);
  assert.equal(result.details.summaries.method, "extractive");
});

await test("invalid query and domain do not access credentials or HTTP", async () => {
  const calls = fixture();
  await assert.rejects(execute({ query: " " }), /query must not be empty/);
  for (const website of ["https://nodejs.org", "../nodejs.org", "localhost", "nodejs.org/path", "-bad.org"]) {
    await assert.rejects(execute({ website }), /domain name/);
  }
  assert.equal(calls.keychain.length, 0);
  assert.equal(calls.fetch.length, 0);
});

await test("JSON results reject unsafe URLs, duplicates and malformed entries; enforce bounds", () => {
  const results = module.parseSearchResults({ results: [
    null, {}, row("javascript:alert(1)"), row("file:///tmp/a"), row("https://user:pass@example.com/"),
    row(), row(), row("https://example.com/", { title: "x".repeat(600), highlights: [3, "y".repeat(1500)] }),
    row("https://other.org/"),
  ] }, 2);
  assert.equal(results.length, 2);
  assert.equal(results[1].title.length, 500);
  assert.equal(results[1].snippet.length, 1000);
  assert.equal(module.parseSearchResults({ results: [row("https://fallback.org", { title: null, highlights: [], text: "Fallback" })] }, 1)[0].snippet, "Fallback");
  assert.equal(module.parseSearchResults({ results: [row("https://fallback.org", { title: null })] }, 1)[0].title, "fallback.org");
  assert.deepEqual(module.parseSearchResults({ results: [] }, 5), []);
  for (const payload of [null, {}, { results: "bad" }]) {
    assert.throws(() => module.parseSearchResults(payload, 5), /results array/);
  }
});

await test("missing, denied, empty and multiline Keychain secrets fail without leakage or HTTP", async () => {
  for (const stdout of [null, "", "a\nb"]) {
    const calls = fixture();
    deps.keychain = async () => {
      if (stdout === null) throw new Error("web_search: " + fakeKey);
      return { stdout };
    };
    await assert.rejects(execute(), error => {
      assert.match(error.message, /Keychain item "exa"/);
      assert.ok(!error.message.includes(fakeKey));
      return true;
    });
    assert.equal(calls.fetch.length, 0);
  }
});

await test("HTTP failures report status only, including auth and rate limits", async () => {
  for (const status of [401, 403, 429, 500]) {
    fixture();
    deps.fetch = async () => new Response(fakeKey, { status });
    await assert.rejects(execute(), error => {
      assert.equal(error.message, `web_search: Exa returned HTTP ${status}.`);
      return true;
    });
  }
});

await test("bad media type, malformed JSON, invalid UTF-8 and invalid schema fail safely", async () => {
  for (const [response, pattern] of [
    [new Response(fakeKey, { headers: { "content-type": "text/html" } }), /response format/],
    [new Response(fakeKey, { headers: { "content-type": "application/json" } }), /invalid JSON/],
    [new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), /invalid JSON/],
    [jsonResponse({ error: fakeKey }), /results array/],
  ]) {
    fixture();
    deps.fetch = async () => response;
    await assert.rejects(execute(), error => {
      assert.match(error.message, pattern);
      assert.ok(!error.message.includes(fakeKey));
      return true;
    });
  }
});

await test("2 MiB response limit accepts exact boundary and rejects overflow", async () => {
  for (const extra of [0, 1]) {
    fixture();
    deps.fetch = async () => new Response('{"results":[]}' + " ".repeat(2 * 1024 * 1024 - 14 + extra), {
      headers: { "content-type": "application/json" },
    });
    if (extra) await assert.rejects(execute(), /2 MiB size limit/);
    else assert.equal((await execute()).details.resultCount, 0);
  }
});

await test("network errors and cancellation cannot expose underlying error text", async () => {
  const calls = fixture();
  deps.fetch = async () => { throw new Error("web_search: " + fakeKey); };
  await assert.rejects(execute(), error => {
    assert.match(error.message, /request failed/);
    assert.ok(!error.message.includes(fakeKey));
    return true;
  });
  const controller = new AbortController();
  controller.abort(new Error(fakeKey));
  await assert.rejects(execute({}, controller.signal), /request cancelled/);
  assert.equal(calls.keychain.length, 1);
});

await test("cancellation during Keychain prevents an HTTP request", async () => {
  const calls = fixture();
  const controller = new AbortController();
  deps.keychain = async () => { controller.abort(); return { stdout: fakeKey }; };
  await assert.rejects(execute({}, controller.signal), /request cancelled/);
  assert.equal(calls.fetch.length, 0);
});

await test("timeout fails before touching credentials", async t => {
  const calls = fixture();
  t.mock.method(AbortSignal, "timeout", ms => {
    assert.equal(ms, 15000);
    return AbortSignal.abort();
  });
  await assert.rejects(execute(), /timed out after 15 seconds/);
  assert.equal(calls.keychain.length, 0);
  assert.equal(calls.fetch.length, 0);
});

await test("empty results skip summaries and missing response body fails", async () => {
  const calls = fixture();
  deps.fetch = async () => jsonResponse({ results: [] });
  assert.equal((await execute({ summarize: true })).details.resultCount, 0);
  assert.equal(calls.summaries.length, 0);
  deps.fetch = async () => new Response(null, { headers: { "content-type": "application/json" } });
  await assert.rejects(execute(), /empty response from Exa/);
});

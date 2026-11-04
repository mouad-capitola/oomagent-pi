import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
test("Playwright MCP pins the package and uses the project configuration", () => {
  const config = read("../.pi/mcp.json").mcpServers.playwright;
  assert.equal(config.command, "npx");
  assert.deepEqual(config.args, ["--yes", "@playwright/mcp@0.0.83", "--config", ".pi/playwright-mcp.json"]);
  assert.equal(config.exposure, "codemode");
  assert.equal(config.env, undefined);
});

test("Playwright has a separate visible browser without imported authentication", () => {
  const config = read("../.pi/playwright-mcp.json");
  assert.equal(config.browser.browserName, "chromium");
  assert.equal(config.browser.isolated, true);
  assert.equal(config.browser.launchOptions.channel, "chromium");
  assert.equal(config.browser.launchOptions.headless, false);
  assert.equal(config.browser.launchOptions.args, undefined);
  assert.equal(config.browser.cdpEndpoint, undefined);
  assert.equal(config.browser.userDataDir, undefined);
  assert.equal(config.browser.contextOptions.storageState, undefined);
  assert.equal(config.extension, undefined);
  assert.equal(config.saveSession, false);
  assert.equal(config.webmcp, false);
  assert.equal(config.outputDir, "/tmp/oomagent-playwright-mcp");
});

test("Playwright follows the native window instead of emulating a fixed viewport", () => {
  const config = read("../.pi/playwright-mcp.json");
  assert.equal(config.browser.contextOptions.viewport, null);
});

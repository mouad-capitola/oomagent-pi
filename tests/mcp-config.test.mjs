import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Crypto MCP is removed, not merely disabled; other browser servers remain", async () => {
  const config = JSON.parse(await readFile(new URL("../.pi/mcp.json", import.meta.url), "utf8"));
  assert.equal(Object.hasOwn(config.mcpServers, "crypto"), false);
  for (const name of ["lightpanda", "playwright"]) {
    assert.equal(Object.hasOwn(config.mcpServers, name), true);
    assert.notEqual(config.mcpServers[name].enabled, false);
  }
});

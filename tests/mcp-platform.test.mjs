import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { LIGHTPANDA_IMAGE, lightpandaCommand } from "../scripts/lightpanda-mcp.mjs";
import { readZapMcpKey, zapConfigPath } from "../scripts/zap-mcp-key.mjs";

const flags = ["mcp", "--block-private-networks", "--block-cidrs", "-127.0.0.1/32", "--obey-robots"];

test("MCP config keeps browser restrictions, local ZAP authentication and disabled bridge", async () => {
  const { mcpServers } = JSON.parse(await readFile(new URL("../.pi/mcp.json", import.meta.url), "utf8"));
  assert.equal(mcpServers.lightpanda.command, "node");
  assert.deepEqual(mcpServers.lightpanda.args, ["scripts/lightpanda-mcp.mjs", ...flags]);
  assert.equal(mcpServers.zap.url, "http://127.0.0.1:8282/");
  assert.equal(mcpServers.zap.headers.Authorization, "!node scripts/zap-mcp-key.mjs");
  assert.equal(mcpServers["oomagent-pi"].enabled, false);
});

test("macOS retains the native Lightpanda binary and all arguments", () => {
  const result = lightpandaCommand(flags, "darwin", "/Users/test user");
  assert.equal(result.command.replaceAll("\\", "/"), "/Users/test user/.local/bin/lightpanda");
  assert.deepEqual(result.args, flags);
});

test("Windows runs pinned Lightpanda over stdio without publishing ports or mounting host files", () => {
  assert.match(LIGHTPANDA_IMAGE, /^lightpanda\/browser@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(lightpandaCommand(flags, "win32"), {
    command: "docker",
    args: ["run", "--rm", "--interactive", "--pull=never", "--env", "LIGHTPANDA_DISABLE_TELEMETRY=true", LIGHTPANDA_IMAGE, "/bin/lightpanda", ...flags],
  });
});

test("ZAP uses each platform's documented config location", () => {
  assert.equal(zapConfigPath("win32", "C:\\Users\\test user"), "C:\\Users\\test user\\ZAP\\config.xml");
  assert.equal(zapConfigPath("darwin", "/Users/test user"), "/Users/test user/Library/Application Support/ZAP/config.xml");
  assert.equal(zapConfigPath("linux", "/home/test"), "/home/test/.ZAP/config.xml");
});

test("ZAP key lookup passes paths as data, never shell interpolation", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const home = platform === "win32" ? "C:\\Users\\test ' user" : "/home/test ' user";
    const key = readZapMcpKey({ platform, home, run(command, args, options) {
      assert.equal(options.shell, undefined);
      assert.equal(options.timeout, 10000);
      if (platform === "win32") {
        assert.equal(command, "powershell.exe");
        assert.equal(options.env.OOMAGENT_ZAP_CONFIG, zapConfigPath(platform, home));
        assert.ok(!args.at(-1).includes(home));
      } else {
        assert.equal(command, "python3");
        assert.equal(args.at(-1), zapConfigPath(platform, home));
      }
      return { status: 0, stdout: "fixture-only-key" };
    } });
    assert.equal(key, "fixture-only-key");
  }
});

test("key lookup rejects errors, empty keys and header injection without exposing parser output", () => {
  for (const result of [
    { status: 1, stdout: "private-data", stderr: "private-data" },
    { status: 0, stdout: "" },
    { status: 0, stdout: "key\r\nInjected: value" },
    { status: 0, stdout: "key\n" },
    { status: null, error: new Error("private-data") },
  ]) {
    assert.throws(() => readZapMcpKey({ run: () => result }), error => {
      assert.match(error.message, /Cannot read the ZAP MCP key/);
      assert.ok(!error.message.includes("private-data"));
      return true;
    });
  }
});

test("native XML reader handles entities and rejects missing, malformed and unsafe XML", async t => {
  const home = await mkdtemp(join(tmpdir(), "oomagent-zap-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = zapConfigPath(process.platform, home);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "<config><mcp><securityKey>fixture&amp;key</securityKey></mcp></config>");
  assert.equal(readZapMcpKey({ home }), "fixture&key");
  for (const xml of ["<config/>", "<config><mcp>", '<!DOCTYPE config [<!ENTITY x SYSTEM "file:///nonexistent">]><config><mcp><securityKey>&x;</securityKey></mcp></config>']) {
    await writeFile(file, xml);
    assert.throws(() => readZapMcpKey({ home }), /Cannot read the ZAP MCP key/);
  }
});

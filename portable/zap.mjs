// Local authenticated ZAP lifecycle only. No target, spider or scan is started here.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, openSync, closeSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createOnce } from "./configure.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const home = join(root, ".portable/state/zap");
const endpoint = "http://127.0.0.1:8282/";
mkdirSync(home, { recursive: true, mode: 0o700 });
createOnce(join(home, "mcp-key"), randomBytes(24).toString("hex"));
createOnce(join(home, "api-key"), randomBytes(24).toString("hex"));
const key = readFileSync(join(home, "mcp-key"), "utf8").trim();
const apiKey = readFileSync(join(home, "api-key"), "utf8").trim();

async function connected() {
  try {
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
      headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "oomagent-pi-doctor", version: "1" },
      } }),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new Error("Port 8282 belongs to another service/key; stop it or configure ZAP manually. Nothing was replaced.");
    }
    if (!response.ok) { await response.body?.cancel(); return false; }
    return Boolean((await response.json()).result?.serverInfo);
  } catch (error) {
    if (error.message.startsWith("Port 8282")) throw error;
    return false;
  }
}

try {
  const action = process.argv[2] ?? "status";
  if (!["start", "stop", "status"].includes(action)) throw new Error("Usage: ./tools zap start|stop|status");
  const ready = await connected();
  if (action === "status") {
    console.log(ready ? "ZAP MCP connected (loopback, authenticated)." : "ZAP MCP stopped.");
    process.exitCode = ready ? 0 : 1;
  } else if (action === "stop") {
    if (ready) {
      const url = new URL("http://127.0.0.1:18080/JSON/core/action/shutdown/");
      url.searchParams.set("apikey", apiKey);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("ZAP shutdown failed; no other process was stopped.");
      await response.body?.cancel();
    }
  } else if (!ready) {
    const lock = join(home, "starting.lock");
    let ownsLock = false;
    try {
      try { mkdirSync(lock); ownsLock = true; }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      let child;
      if (ownsLock) {
        createOnce(join(home, "startup.properties"), [
          "mcp.enabled=true", "mcp.port=8282", "mcp.securityKeyEnabled=true", "mcp.securityKey=" + key,
          "mcp.secureOnly=false", "mcp.recordInHistory=false", "api.disablekey=false", "api.key=" + apiKey,
          "api.addrs.addr.name=127.0.0.1", "api.addrs.addr.regex=false", "autoupdate.checkOnStart=false",
        ].join("\n") + "\n");
        const log = openSync(join(home, "startup.log"), "a", 0o600);
        child = spawn("bash", [join(root, ".portable/zap/zap.sh"), "-daemon", "-silent", "-dir", home,
          "-host", "127.0.0.1", "-port", "18080", "-configfile", join(home, "startup.properties")], {
          cwd: home, detached: true, stdio: ["ignore", log, log],
        });
        closeSync(log);
        child.on("error", () => {});
        child.unref();
      }
      let started = false;
      for (let attempt = 0; attempt < 90; attempt++) {
        if (await connected()) { started = true; break; }
        if (child?.exitCode !== null && child?.exitCode !== undefined) break;
        await delay(1000);
      }
      if (!started) {
        if (child?.pid && child.exitCode === null) {
          try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
        }
        throw new Error("ZAP did not start; inspect .portable/state/zap/startup.log locally. No scan was run.");
      }
    } finally { if (ownsLock) rmdirSync(lock); }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

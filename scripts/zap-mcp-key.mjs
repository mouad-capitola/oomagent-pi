import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { posix, win32, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function zapConfigPath(platform = process.platform, home = homedir()) {
  if (platform === "win32") return win32.join(home, "ZAP", "config.xml");
  return posix.join(home, ...(platform === "darwin" ? ["Library", "Application Support", "ZAP"] : [".ZAP"]), "config.xml");
}

const powershell = `
$ErrorActionPreference = 'Stop'
$doc = New-Object System.Xml.XmlDocument
$doc.XmlResolver = $null
$reader = [System.Xml.XmlReader]::Create($env:OOMAGENT_ZAP_CONFIG)
try { $doc.Load($reader) } finally { $reader.Dispose() }
$key = $doc.DocumentElement.SelectSingleNode('mcp/securityKey')
if ($null -eq $key) { exit 1 }
[Console]::Write($key.InnerText)
`;
const python = "import sys, xml.etree.ElementTree as E; key=E.parse(sys.argv[1]).getroot().findtext('mcp/securityKey'); assert key; print(key, end='')";

// stdout is consumed only by Pi's Authorization-header resolver. Never log the key.
export function readZapMcpKey({ platform = process.platform, home = homedir(), run = spawnSync } = {}) {
  const config = zapConfigPath(platform, home);
  const result = platform === "win32"
    ? run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershell], {
      encoding: "utf8", timeout: 10000, windowsHide: true,
      env: { ...process.env, OOMAGENT_ZAP_CONFIG: config },
    })
    : run("python3", ["-c", python, config], { encoding: "utf8", timeout: 10000 });
  const key = result.stdout ?? "";
  if (result.error || result.status !== 0 || !/^[\x21-\x7e]+$/.test(key)) {
    // XML/parser errors can contain configuration contents: do not forward stderr.
    throw new Error("Cannot read the ZAP MCP key. Start ZAP with MCP enabled and check its local config.xml.");
  }
  return key;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(readZapMcpKey());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

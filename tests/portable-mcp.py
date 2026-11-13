"""Real MCP calls against synthetic local data; never inference or a ZAP scan.
Run after ./tools zap start: ./tools python3 tests/portable-mcp.py
"""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import tempfile
import threading

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".portable"


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"User-agent: *\nAllow: /\n" if self.path == "/robots.txt" else b"<title>Portable fixture</title><h1>portable-smoke-content</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain" if self.path == "/robots.txt" else "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


async def stdio_check(name, command, args, calls):
    params = StdioServerParameters(command=str(command), args=[str(arg) for arg in args], env=dict(os.environ))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            names = {tool.name for tool in (await session.list_tools()).tools}
            for tool, arguments, expected in calls:
                assert tool in names, f"{name}: missing tool {tool}"
                result = await session.call_tool(tool, arguments)
                assert not result.isError, f"{name}.{tool} failed"
                if expected:
                    text = "\n".join(item.text for item in result.content if item.type == "text")
                    assert expected in text, f"{name}.{tool}: expected synthetic result missing: {text}"
    print(f"PASS {name}: tools listed and {len(calls)} real calls")


async def main(url, project):
    await stdio_check("hello", STATE / "python/bin/python", [ROOT / "scripts/test-mcp.py"], [("hello", {"name": "portable-test"}, "portable-test")])
    await stdio_check("Lightpanda", STATE / "bin/lightpanda", ["mcp", "--block-private-networks", "--block-cidrs", "-127.0.0.1/32", "--obey-robots"], [
        ("goto", {"url": url}, None), ("markdown", {}, r"portable\-smoke\-content"),
    ])
    # Container tests run as root, unlike normal WSL installs. The sandbox flag
    # is scoped to this synthetic headless fixture, never the shipped config.
    browser_args = ["--headless", "--isolated", "--browser", "chromium", "--output-dir", str(project / "browser-output")]
    if os.getuid() == 0:
        browser_args.append("--no-sandbox")
    await stdio_check("Playwright", STATE / "browser/node_modules/.bin/playwright-mcp", browser_args, [
        ("browser_navigate", {"url": url}, "Portable fixture"),
        ("browser_evaluate", {"function": "() => document.querySelector('h1').textContent"}, "portable-smoke-content"),
        ("browser_close", {}, None),
    ])
    await stdio_check("Serena", STATE / "python/bin/serena", ["start-mcp-server", "--context", "ide", "--transport", "stdio", "--enable-web-dashboard", "false", "--enable-gui-log-window", "false", "--open-web-dashboard", "false"], [
        ("activate_project", {"project": str(project)}, None),
        ("get_symbols_overview", {"relative_path": "probe.py", "depth": 1}, "portable_probe"),
    ])
    key = (STATE / "state/zap/mcp-key").read_text().strip()
    async with streamablehttp_client("http://127.0.0.1:8282/", headers={"Authorization": key}) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("zap_version", {})
            assert not result.isError and "2.17.0" in str(result)
    print("PASS ZAP: authenticated version call only, no scan")


if __name__ == "__main__":
    http = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="portable-semantic-") as temp:
            project = Path(temp)
            (project / "probe.py").write_text("def portable_probe():\n    return 42\n")
            asyncio.run(main(f"http://127.0.0.1:{http.server_port}/", project))
    finally:
        http.shutdown()
        http.server_close()

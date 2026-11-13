"""Offline real-Pi PTY smoke test; no credentials, MCP, model calls or user writes.
Run: python3 tests/start-diagram-terminal.py [fullscreen|regular]
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time

REPO = Path(__file__).resolve().parent.parent
AGENT = Path.home() / ".pi/agent"
VERSION = (AGENT / "install/current-version").read_text().strip()
CLI = AGENT / "install/releases" / VERSION / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
NODE = shutil.which("node")
MODE = sys.argv[1] if len(sys.argv) > 1 else "fullscreen"
assert MODE in ("fullscreen", "regular") and NODE and CLI.is_file()

with tempfile.TemporaryDirectory(prefix="pi-start-pty-") as temp:
    home = Path(temp)
    agent = home / ".pi/agent"
    agent.mkdir(parents=True)
    (home / "Projects").mkdir()
    probe = home / "probe.ts"
    probe.write_text('''export default function(pi) {
      let draftChecks = 0;
      pi.registerShortcut("f6", { handler: async ctx => {
        ctx.ui.notify((ctx.ui.getEditorText() === "concept blijft" ? "DRAFT_OK_" : "DRAFT_LOST_") + ++draftChecks, "info");
      }});
      pi.registerCommand("chat-probe", { handler: async () => {
        pi.sendMessage({ customType: "chat-probe", content: "CHAT_VISIBLE_BELOW_DIAGRAM", display: true }, { triggerTurn: false });
      }});
      pi.registerCommand("check-direct-tools", { handler: async (_args, ctx) => {
        const active = pi.getActiveTools();
        const tools = pi.getAllTools();
        const ok = ["read", "bash", "edit", "write", "grep", "find", "ls", "tool_search"].every(n => active.includes(n))
          && !tools.some(t => t.name === "codemode");
        ctx.ui.notify(ok ? "DIRECT_TOOLS_OK" : "DIRECT_TOOLS_FAILED", "info");
      }});
    }''')
    project = json.loads((REPO / ".pi/settings.json").read_text())
    settings = {
        "defaultTools": project["defaultTools"], "codemode": project["codemode"],
        "extensions": project["extensions"] + ["-builtin:mcp", str(probe),
            str(REPO / ".pi/extensions/oomagent-start.ts"),
            str(REPO / ".pi/extensions/oomagent-workspace.ts"),
            str(REPO / ".pi/extensions/oomagent-ui.ts")],
        "themes": [str(REPO / ".pi/themes/oomagent-swiss.json")],
        "defaultProvider": "openai", "defaultModel": "gpt-4o",
        "defaultProjectTrust": "never", "quietStartup": project["quietStartup"],
        "tuiMode": MODE, "enableInstallTelemetry": False,
    }
    (agent / "settings.json").write_text(json.dumps(settings))
    env = {"PATH": os.environ.get("PATH", ""), "HOME": temp, "TERM": "xterm-256color",
           "PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1", "PI_IMAGE_PROTOCOL": "none"}
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(REPO)
        os.execve(NODE, [NODE, str(CLI), "--tui-mode", MODE], env)
    alive = True
    output = bytearray()
    mark = 0

    def resize(rows, cols):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        os.kill(pid, signal.SIGWINCH)

    def pump(timeout=0.2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    data = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        return
                    raise
                if not data:
                    return
                output.extend(data)

    def visible():
        return re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output[mark:]).decode(errors="replace")

    def expect(text):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if text in visible():
                return
            pump()
        raise AssertionError("Missing terminal state: " + text + "\n" + visible()[:3000] + "\n" + visible()[-1500:])

    def send(data):
        global mark
        mark = len(output)
        os.write(fd, data)
        pump()

    try:
        resize(40, 120)
        expect("📁 oomagent-pi")
        expect("◉ TOKENS")  # No dismissal: the editor/footer are immediately usable.
        assert "november" not in visible(), "No duplicate text caption below the block date"
        expect("█")  # Large white block digits, not a one-line date with an underline.
        expect("▓")
        expect("░")  # Two offset depth layers.
        expect("📁 skills")
        expect("📁 extensions")
        expect("📁 prompts")
        assert "Root-items" not in visible()
        assert "📁 .git" not in visible() and "📁 node_modules" not in visible()
        assert "┴" in visible() or "┼" in visible()
        assert visible().count("📄") > 3
        def expect_quiet():
            for text in ["ENGINEERING WORKSPACE", "Inspecteren", "[Context]", "[Skills]", "[Prompts]", "[Extensions]"]:
                assert text not in visible(), "Unexpected startup content: " + text
        expect_quiet()
        send(b"/chat-probe\r")
        expect("CHAT_VISIBLE_BELOW_DIAGRAM")
        send(b"/new\r")
        expect("New session started")  # Pi 1.5.2 has no supported way to hide this notice.
        expect("📁 oomagent-pi")
        expect("◉ TOKENS")
        expect_quiet()
        send(b"concept blijft")
        send(b"\x1b[D\x1b[C")  # Arrows must still edit the draft, not navigate the diagram.
        send(b"\x1b[17~")  # F6: probe the real editor without submitting to a model.
        expect("DRAFT_OK_1")
        mark = len(output)
        resize(14, 30)
        expect("concept blijft")  # Chat/editor take priority; header may scroll out of view.
        expect("◉ TOKENS")
        mark = len(output)
        resize(40, 120)
        expect("📁 oomagent-pi")
        send(b"\x1b[17~")
        expect("DRAFT_OK_2")
        send(b"\x15")  # Clear the test draft locally, never submit it.
        send(b"/oom-start omlaag\r")
        expect("rijen")
        expect("📄 SKILL.md")  # Nested files remain reachable below the first viewport.
        send(b"/oom-start volgende\r")
        expect("2/")
        send(b"/check-direct-tools\r")
        expect("DIRECT_TOOLS_OK")
        send(b"/reload\r")
        expect("📁 oomagent-pi")
        expect("◉ TOKENS")
        expect_quiet()
        send(b"/oom-start verberg\r")
        mark = len(output)
        resize(40, 119)  # Force a full frame; unchanged rows need not be emitted by Pi.
        expect("◉ TOKENS")
        assert "📁 oomagent-pi" not in visible()
        send(b"/oom-start toon\r")
        expect("📁 oomagent-pi")
        send(b"/workspace\r")
        expect("Actief:")
        send(b"/workspace\r")
        send(b"/quit\r")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            pump()
            ended, status = os.waitpid(pid, os.WNOHANG)
            if ended:
                alive = False
                assert os.waitstatus_to_exitcode(status) == 0
                break
        assert not alive, "Pi did not exit"
        for error in [b"Extension error", b"Failed to load extension", b"DIRECT_TOOLS_FAILED", b"DRAFT_LOST"]:
            assert error not in output
        print(f"PASS ({MODE}): persistent organigram + typing/arrows -> draft preserved across resize 30/120 -> scroll/next -> direct tools -> reload -> hide/show -> workspace -> quit; offline PTY")
    finally:
        if alive:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            ended, _ = os.waitpid(pid, os.WNOHANG)
            if not ended:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        os.close(fd)

"""Offline real-Pi PTY: external project banner and untouched default editor.
Run: python3 tests/project-presentation-terminal.py [fullscreen|regular]
Uses isolated HOME/config, no credentials, MCP or model calls.
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
if os.environ.get("PI_TEST_CLI"):
    CLI = Path(os.environ["PI_TEST_CLI"])
else:
    AGENT = Path.home() / ".pi/agent"
    VERSION = (AGENT / "install/current-version").read_text().strip()
    CLI = AGENT / "install/releases" / VERSION / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
MODE = sys.argv[1] if len(sys.argv) > 1 else "fullscreen"
assert MODE in ("fullscreen", "regular")
with tempfile.TemporaryDirectory(prefix="pi-presentation-pty-") as temp:
    home = Path(temp)
    project = home / "Other-App"
    project.mkdir()
    agent = home / ".pi/agent"
    agent.mkdir(parents=True)
    probe = home / "probe.ts"
    probe.write_text('''export default function(pi) {
      pi.registerShortcut("f6", { handler: async ctx => {
        const ok = ctx.ui.getEditorText() === "draft stays" && ctx.ui.getEditorComponent() === undefined;
        ctx.ui.notify(ok ? "DEFAULT_EDITOR_OK" : "EDITOR_FAILED", "info");
      }});
    }''')
    (agent / "settings.json").write_text(json.dumps({
        "extensions": ["-builtin:mcp", "-builtin:codemode", str(probe)] + [
            str(REPO / ".pi/extensions" / name) for name in
            ["oomagent-start.ts", "oomagent-workspace.ts", "oomagent-ui.ts"]],
        "themes": [str(REPO / ".pi/themes/oomagent-swiss.json")],
        "defaultProvider": "openai", "defaultModel": "gpt-4o",
        "defaultProjectTrust": "never", "quietStartup": True,
        "tuiMode": MODE, "enableInstallTelemetry": False,
    }))
    env = {"PATH": os.environ["PATH"], "HOME": temp, "TERM": "xterm-256color",
           "PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1", "PI_IMAGE_PROTOCOL": "none"}
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(project)
        os.execve(shutil.which("node"), [shutil.which("node"), str(CLI)], env)
    output = bytearray()
    mark = 0
    alive = True

    def pump():
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output.extend(os.read(fd, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def text():
        return re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output[mark:]).decode(errors="replace")

    def expect(value):
        deadline = time.monotonic() + 15
        while value not in text():
            assert time.monotonic() < deadline, "Missing " + value + "\n" + text()[-3000:]
            pump()

    def send(value):
        global mark
        mark = len(output)
        os.write(fd, value)

    def resize(rows, cols):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        os.kill(pid, signal.SIGWINCH)

    try:
        resize(40, 120)
        expect("Other-App")
        expect("◉ TOKENS")
        for glyph in ["█", "▓"]:
            expect(glyph)
        assert "░" not in text(), "Project title must have only one shadow layer"
        assert "📁 oomagent-pi" not in text() and "ENGINEERING WORKSPACE" not in text()
        send(b"draft stays\x1b[17~")
        expect("DEFAULT_EDITOR_OK")
        resize(14, 30)
        send(b"\x1b[17~")
        expect("DEFAULT_EDITOR_OK")
        resize(40, 120)
        send(b"\x15/reload\r")
        expect("Other-App")
        send(b"/workspace\r")
        expect("alleen beschikbaar")
        send(b"draft stays\x1b[17~")
        expect("DEFAULT_EDITOR_OK")
        send(b"\x15/quit\r")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            pump()
            ended, status = os.waitpid(pid, os.WNOHANG)
            if ended:
                alive = False
                assert os.waitstatus_to_exitcode(status) == 0
                break
        assert not alive
        for failure in [b"Extension error", b"Failed to load extension", b"EDITOR_FAILED"]:
            assert failure not in output
        print(f"PASS ({MODE}): external 3D project name + footer + default editor, resize, reload, workspace blocked, quit")
    finally:
        if alive:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            ended, _ = os.waitpid(pid, os.WNOHANG)
            if not ended:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        os.close(fd)

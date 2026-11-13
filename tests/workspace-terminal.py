"""Offline PTY smoke test. Uses a temporary HOME, projects and Pi agent directory.
No real credentials, model requests, MCP servers or user files are used.
Run: python3 tests/workspace-terminal.py
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
import tempfile
import termios
import time

REPO = Path(__file__).resolve().parent.parent
AGENT = Path.home() / ".pi/agent"
VERSION = (AGENT / "install/current-version").read_text().strip()
CLI = AGENT / "install/releases" / VERSION / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
NODE = shutil.which("node")
assert NODE and CLI.is_file()

with tempfile.TemporaryDirectory(prefix="pi-workspace-pty-") as temp:
    home = Path(temp)
    agent = home / ".pi/agent"
    agent.mkdir(parents=True)
    projects = home / "Projects"
    for name in ("alpha", "beta"):
        (projects / name).mkdir(parents=True)
        (projects / name / "hello.txt").write_text("original\n")
    (agent / "settings.json").write_text(json.dumps({
        "extensions": [str(REPO / ".pi/extensions/oomagent-workspace.ts"), str(REPO / ".pi/extensions/oomagent-ui.ts"), "-builtin:mcp"],
        "themes": [str(REPO / ".pi/themes/oomagent-swiss.json")],
        "defaultProvider": "openai", "defaultModel": "gpt-4o",
        "defaultProjectTrust": "never", "quietStartup": True,
        "tuiMode": "fullscreen", "enableInstallTelemetry": False,
    }))
    env = {"PATH": os.environ.get("PATH", ""), "HOME": temp, "TERM": "xterm-256color",
           "PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1", "PI_IMAGE_PROTOCOL": "none"}
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(projects / "beta")
        os.execve(NODE, [NODE, str(CLI)], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    output = bytearray()
    alive = True
    mark = 0

    def read_until(needle, timeout=15, raw=False):
        start = mark
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            # The fake text cursor can insert SGR codes inside a visible word.
            visible = output[start:] if raw else re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output[start:])
            if needle.encode() in visible:
                return
            readable, _, _ = select.select([fd], [], [], 0.1)
            if readable:
                try:
                    data = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                output.extend(data)
        raise AssertionError("Missing terminal state: " + needle + "\n" + output[-4000:].decode(errors="replace"))

    def send(data):
        global mark
        mark = len(output)
        os.write(fd, data)
        deadline = time.monotonic() + 0.35
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break

    def wait_for_chat(new_process=False):
        global mark
        if new_process:
            # Ignore frames from the old process while a confirmed restart exits.
            read_until("\x1b[?1049h", timeout=20, raw=True)
            mark = output.index(b"\x1b[?1049h", mark)
        read_until("◉ TOKENS")
        visible = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output[mark:])
        assert b"Typ ready" not in visible, "welcome screen must not block chat"
        assert b"Actief:" not in visible, "workspace panels must start hidden"

    try:
        wait_for_chat(new_process=True)
        send(b"/reload\r")
        wait_for_chat()
        send(b"/workspace\r")
        read_until("Actief:")
        send(b"\x1bOQ")  # F2: tree
        send(b"\r")  # expand alpha
        send(b"\x1b[B\r")  # open hello.txt
        # Allow the newly expanded, non-active project to acquire a baseline.
        time.sleep(1.2)
        send(b"")
        mark = len(output)
        (projects / "alpha/hello.txt").write_text("LIVE original\n")
        read_until("LIVE original")
        send(b"\x1bOS")  # F4: compare saved external change
        read_until("DIFF")
        diff_frame = output[mark:]
        assert b"\x1b[32m" in diff_frame and b"\x1b[31m" in diff_frame
        assert diff_frame.index(b"\x1b[32m") < diff_frame.index(b"\x1b[31m")
        send(b"\x1bOS")  # return to editable code
        mark = len(output)
        (projects / "alpha/hello.txt").write_text("original\n")
        read_until("original")
        send(b"EDIT ")
        send(b"\x13")  # Ctrl+S
        assert (projects / "alpha/hello.txt").read_text() == "EDIT original\n", output[-5000:].decode(errors="replace")
        assert (projects / "beta/hello.txt").read_text() == "original\n"
        send(b"\x1b")  # chat
        send(b"/workspace-activate\r")
        read_until("Project activeren")
        # Pi confirm uses Yes / No, selected Yes.
        send(b"\r")
        wait_for_chat(new_process=True)
        send(b"/workspace\r")
        read_until("Actief:")
        assert b"Projects/alpha" in output[mark:], "active project did not change"
        # Leave a dirty editor buffer, quit, then check private recovery storage.
        send(b"\x1bOQ")
        send(b"\r")
        send(b"\x1b[B\r")
        send(b"DRAFT ")
        send(b"\x1b")
        send(b"/quit\r")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            ended, status = os.waitpid(pid, os.WNOHANG)
            if ended:
                alive = False
                assert os.waitstatus_to_exitcode(status) == 0
                break
            select.select([fd], [], [], 0.1)
            try:
                if select.select([fd], [], [], 0)[0]:
                    os.read(fd, 65536)
            except OSError:
                pass
        assert not alive, "Pi did not exit cleanly"
        saved = list((agent / "workspace-drafts").glob("draft-*.json"))
        assert len(saved) == 1, "dirty buffer was not preserved"
        draft = json.loads(saved[0].read_text())
        assert draft["text"].startswith("DRAFT EDIT original")
        assert draft["original"] == "EDIT original\n"
        assert saved[0].stat().st_mode & 0o777 == 0o600
        assert (projects / "alpha/hello.txt").read_text() == "EDIT original\n"
        assert b"Extension error" not in output and b"Failed to load extension" not in output
        # Restart in the same isolated HOME and restore the saved draft.
        os.close(fd)
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(projects / "alpha")
            os.execve(NODE, [NODE, str(CLI)], env)
        alive = True
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        mark = len(output)
        wait_for_chat(new_process=True)
        send(b"/workspace\r")
        read_until("Actief:")
        send(b"/workspace-recover\r")
        read_until("Kies een lokaal concept")
        send(b"\r")
        send(b"\x13")
        assert (projects / "alpha/hello.txt").read_text() == "DRAFT EDIT original\n"
        # Resize while editor is focused; hidden panels must fall back to chat.
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 12, 30, 0, 0))
        os.kill(pid, signal.SIGWINCH)
        time.sleep(0.2)
        send(b"\x1b")
        send(b"/quit\r")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            ended, status = os.waitpid(pid, os.WNOHANG)
            if ended:
                alive = False
                assert os.waitstatus_to_exitcode(status) == 0
                break
            if select.select([fd], [], [], 0.1)[0]:
                try:
                    output.extend(os.read(fd, 65536))
                except OSError:
                    pass
        assert not alive
        assert b"Extension error" not in output
        assert b"Typ ready" not in re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output)
        print("PASS: direct chat -> reload -> /workspace -> tree -> edit/save -> confirmed project restart -> private draft -> recovery/save -> resize -> quit (offline PTY)")
    finally:
        if alive:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            ended, _ = os.waitpid(pid, os.WNOHANG)
            if not ended:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        os.close(fd)

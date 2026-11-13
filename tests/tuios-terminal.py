"""TUIOS startup/quit in a real PTY, isolated HOME and no existing sessions."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import signal
import struct
import tempfile
import termios
import time

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="tuios-portable-") as temp:
    home = Path(temp)
    config = home / ".config/tuios"
    config.mkdir(parents=True)
    (config / "config.toml").write_bytes((root / "portable/tuios.toml").read_bytes())
    env = {"HOME": temp, "PATH": os.environ["PATH"], "SHELL": "/bin/bash", "TERM": "xterm-256color", "COLORTERM": "truecolor"}
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(temp)
        os.execve(str(root / "tuios"), [str(root / "tuios"), "--standalone", "--no-animations", "--ascii-only"], env)
    output = bytearray()
    alive = True

    def pump():
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output.extend(os.read(fd, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
        os.kill(pid, signal.SIGWINCH)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            pump()
        assert b"\x1b[?1049h" in output, "TUIOS did not enter the terminal UI"
        assert len(output) > 500, "TUIOS did not render a screen"
        os.write(fd, b"\x02q")  # documented prefix_quit
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            pump()
            ended, status = os.waitpid(pid, os.WNOHANG)
            if ended:
                alive = False
                assert os.waitstatus_to_exitcode(status) == 0
                break
        assert not alive, "TUIOS did not quit through its keybinding"
        assert b"panic:" not in output
        print("PASS TUIOS: real PTY startup/render and Ctrl+B q exit; isolated HOME")
    finally:
        if alive:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
        os.close(fd)

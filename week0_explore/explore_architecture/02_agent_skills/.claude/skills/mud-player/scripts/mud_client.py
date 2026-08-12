#!/usr/bin/env python3
"""Telnet connection manager for playing a MUD (tbaMUD/CircleMUD) from a
non-interactive shell tool.

A single Bash call can't hold an interactive telnet session open, and the
game's state (character position, HP, combat) lives on the *connection*, not
just the account -- so every command needs to reuse the same live socket.
This script solves that by spawning a small background daemon that owns the
TCP connection, and talking to it over a local control socket for each
command. The daemon keeps running (and the MUD connection stays open) across
as many `send`/`read` calls as needed, until `disconnect` is used.

Subcommands:
  connect              Open a connection (spawns the background daemon) and
                        print whatever the server sends first (banner/login
                        prompt).
  send TEXT             Send one line of input (a command, a name, a
                        password, "y", an empty line for "press enter", ...)
                        and print the server's response.
  read                  Read any output that has arrived without sending
                        anything (useful when a screen is still loading or
                        combat is producing several rounds of text).
  status                Report whether a session is currently connected.
  disconnect            Close the connection and stop the background daemon.

Examples:
  mud_client.py connect
  mud_client.py send "dummy"
  mud_client.py send "helloworld"
  mud_client.py send "look"
  mud_client.py read --wait 3
  mud_client.py disconnect

Session state lives in /tmp/mud_client_<host>_<port>.{sock,pid,log} so that
separate invocations of this script (each a fresh process) can find the same
running daemon. The .log file holds the raw, unfiltered transcript (telnet
negotiation bytes and ANSI codes included) for debugging a connection that
seems stuck.
"""
import argparse
import json
import os
import re
import signal
import socket
import sys
import threading
import time

DEFAULT_HOST = os.environ.get("MUD_HOST", "localhost")
DEFAULT_PORT = int(os.environ.get("MUD_PORT", "4000"))

ANSI_RE = re.compile(rb"\x1b\[[0-9;]*[a-zA-Z]")

IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240


def session_paths(session):
    base = f"/tmp/mud_client_{session}"
    return {"sock": base + ".sock", "pid": base + ".pid", "log": base + ".log"}


def strip_telnet(data: bytes) -> bytes:
    """Strip telnet IAC option-negotiation sequences out of a raw byte stream."""
    out = bytearray()
    i, n = 0, len(data)
    while i < n:
        b = data[i]
        if b == IAC:
            if i + 1 >= n:
                break
            cmd = data[i + 1]
            if cmd == IAC:
                out.append(IAC)
                i += 2
            elif cmd in (DO, DONT, WILL, WONT):
                i += 3
            elif cmd == SB:
                j = i + 2
                while j + 1 < n and not (data[j] == IAC and data[j + 1] == SE):
                    j += 1
                i = j + 2
            else:
                i += 2
            continue
        out.append(b)
        i += 1
    return bytes(out)


class MudDaemon:
    """Owns the live TCP connection to the MUD and serves control requests
    over a unix socket so short-lived CLI invocations can drive it."""

    def __init__(self, host, port, session):
        self.host, self.port, self.session = host, port, session
        self.paths = session_paths(session)
        self.buffer = []
        self.read_cursor = 0
        self.lock = threading.Lock()
        self.last_data_time = time.time()
        self.sock = None
        self.running = True

    def log(self, raw: bytes):
        with open(self.paths["log"], "ab") as f:
            f.write(raw)

    def reader_loop(self):
        while self.running:
            try:
                data = self.sock.recv(4096)
            except OSError:
                break
            if not data:
                with self.lock:
                    self.buffer.append("\n[connection closed by server]\n")
                    self.last_data_time = time.time()
                break
            self.log(data)
            text = ANSI_RE.sub(b"", strip_telnet(data)).decode("utf-8", errors="replace")
            with self.lock:
                self.buffer.append(text)
                self.last_data_time = time.time()

    def collect(self, max_wait=4.0, idle=0.6):
        """Return all text buffered since the last collect() call (the read
        cursor), stopping once output goes quiet for `idle` seconds or
        `max_wait` total seconds have elapsed.

        The cursor is tracked on the daemon rather than per-request, because
        data can arrive between two separate CLI invocations (e.g. a slow
        banner finishing after `connect` already returned) -- a per-request
        snapshot would silently drop that text instead of surfacing it on
        the next `read`/`send`.
        """
        start = time.time()
        while True:
            time.sleep(0.05)
            with self.lock:
                have_new = len(self.buffer) > self.read_cursor
                idle_elapsed = time.time() - self.last_data_time
            if time.time() - start >= max_wait:
                break
            if have_new and idle_elapsed >= idle:
                break
        with self.lock:
            chunk = "".join(self.buffer[self.read_cursor:])
            self.read_cursor = len(self.buffer)
        return chunk

    def handle_client(self, conn):
        try:
            raw = conn.recv(65536)
            req = json.loads(raw.decode("utf-8"))
            cmd = req.get("cmd")
            if cmd == "send":
                self.sock.sendall((req.get("text", "") + "\r\n").encode("utf-8", errors="replace"))
                chunk = self.collect(req.get("max_wait", 5.0), req.get("idle", 1.0))
                resp = {"ok": True, "output": chunk}
            elif cmd == "read":
                chunk = self.collect(req.get("max_wait", 4.0), req.get("idle", 1.0))
                resp = {"ok": True, "output": chunk}
            elif cmd == "status":
                resp = {"ok": True, "connected": True}
            elif cmd == "stop":
                conn.sendall(json.dumps({"ok": True, "output": "disconnected"}).encode("utf-8"))
                conn.close()
                self.shutdown()
                return
            else:
                resp = {"ok": False, "error": f"unknown cmd {cmd!r}"}
            conn.sendall(json.dumps(resp).encode("utf-8"))
        except Exception as e:
            try:
                conn.sendall(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            except OSError:
                pass
        finally:
            conn.close()

    def shutdown(self):
        self.running = False
        try:
            self.sock.close()
        except OSError:
            pass
        for p in (self.paths["sock"], self.paths["pid"]):
            try:
                os.remove(p)
            except OSError:
                pass
        os._exit(0)

    def run(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        threading.Thread(target=self.reader_loop, daemon=True).start()

        if os.path.exists(self.paths["sock"]):
            os.remove(self.paths["sock"])
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.paths["sock"])
        srv.listen(5)

        with open(self.paths["pid"], "w") as f:
            f.write(str(os.getpid()))

        signal.signal(signal.SIGTERM, lambda *a: self.shutdown())

        while self.running:
            try:
                conn, _ = srv.accept()
            except OSError:
                break
            self.handle_client(conn)


def send_control(session, payload, timeout=15):
    paths = session_paths(session)
    if not os.path.exists(paths["sock"]):
        return None
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(paths["sock"])
    except OSError:
        return None
    s.sendall(json.dumps(payload).encode("utf-8"))
    chunks = []
    while True:
        try:
            d = s.recv(65536)
        except socket.timeout:
            break
        if not d:
            break
        chunks.append(d)
    s.close()
    if not chunks:
        return None
    try:
        return json.loads(b"".join(chunks).decode("utf-8"))
    except ValueError:
        return None


def cmd_connect(args):
    paths = session_paths(args.session)
    existing = send_control(args.session, {"cmd": "status"})
    if existing and existing.get("ok"):
        print("Already connected. Use 'send'/'read' to interact, or 'disconnect' to close.")
        return

    for p in paths.values():
        try:
            os.remove(p)
        except OSError:
            pass
    open(paths["log"], "wb").close()

    pid = os.fork()
    if pid == 0:
        os.setsid()
        devnull = os.open(os.devnull, os.O_RDWR)
        os.dup2(devnull, 0)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        try:
            MudDaemon(args.host, args.port, args.session).run()
        except Exception:
            pass
        os._exit(0)

    deadline = time.time() + 6
    while time.time() < deadline and not os.path.exists(paths["sock"]):
        time.sleep(0.1)
    if not os.path.exists(paths["sock"]):
        print(f"ERROR: could not connect to {args.host}:{args.port} "
              f"(is the MUD server running?)", file=sys.stderr)
        sys.exit(1)

    # tbaMUD's initial banner arrives in several bursts as it runs client
    # protocol detection (MXP/MSDP/ATCP/...), with multi-second gaps between
    # bursts -- a short idle window here would return only the first burst
    # and (worse) invite sending input while the server is still mid
    # negotiation, which it silently discards. Wait generously.
    resp = send_control(args.session, {"cmd": "read", "max_wait": 8.0, "idle": 1.5})
    if resp and resp.get("ok"):
        print(resp["output"], end="")
    else:
        print("Connected. (no banner text received yet -- try 'read')")


def _require_session(args):
    resp = send_control(args.session, {"cmd": "status"})
    if not resp or not resp.get("ok"):
        print("Not connected. Run 'connect' first.", file=sys.stderr)
        sys.exit(1)


def cmd_send(args):
    _require_session(args)
    resp = send_control(args.session, {"cmd": "send", "text": args.text,
                                        "max_wait": args.wait, "idle": args.idle})
    print(resp["output"], end="") if resp and resp.get("ok") else sys.exit("send failed")


def cmd_read(args):
    _require_session(args)
    resp = send_control(args.session, {"cmd": "read", "max_wait": args.wait, "idle": args.idle})
    print(resp["output"], end="") if resp and resp.get("ok") else sys.exit("read failed")


def cmd_status(args):
    resp = send_control(args.session, {"cmd": "status"})
    if resp and resp.get("ok"):
        print(f"Connected to {args.host}:{args.port} (session {args.session}).")
    else:
        print("Not connected.")


def cmd_disconnect(args):
    resp = send_control(args.session, {"cmd": "stop"})
    paths = session_paths(args.session)
    # Leave the .log file in place -- it's the most useful thing to inspect
    # right after a session ends oddly. The next `connect` truncates it fresh.
    for key in ("sock", "pid"):
        try:
            os.remove(paths[key])
        except OSError:
            pass
    print("Disconnected." if resp and resp.get("ok") else "Not connected (nothing to do).")


def main():
    parser = argparse.ArgumentParser(description="Telnet connection manager for a MUD session.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--session", default=None,
                         help="Session name for socket/log files (default: <host>_<port>).")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("connect", help="Open the connection and print the initial banner.")

    p_send = sub.add_parser("send", help="Send one line of input and print the response.")
    p_send.add_argument("text", help="Text to send (a command, name, password, y/n, or empty string).")
    p_send.add_argument("--wait", type=float, default=5.0, help="Max seconds to wait for a response.")
    p_send.add_argument("--idle", type=float, default=1.0, help="Stop early after this many quiet seconds.")

    p_read = sub.add_parser("read", help="Read any output that has arrived without sending anything.")
    p_read.add_argument("--wait", type=float, default=4.0)
    p_read.add_argument("--idle", type=float, default=1.0)

    sub.add_parser("status", help="Report whether a session is connected.")
    sub.add_parser("disconnect", help="Close the connection and stop the daemon.")

    args = parser.parse_args()
    if args.session is None:
        args.session = f"{args.host}_{args.port}"

    {
        "connect": cmd_connect,
        "send": cmd_send,
        "read": cmd_read,
        "status": cmd_status,
        "disconnect": cmd_disconnect,
    }[args.command](args)


if __name__ == "__main__":
    main()

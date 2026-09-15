#!/usr/bin/env python3
"""Hermes Console — a companion server for Hermes Agent.

Runs next to the Hermes gateway on the same machine and provides:
  * username/password login for the Hermes Console web app
  * an authenticated proxy to the Hermes API server (API key never leaves the server)
  * bot (profile) management through the `hermes` CLI
  * Kanban task management through the `hermes kanban` CLI
  * a file browser for everything your bots generate
  * the prebuilt web app (../web/dist) — nothing has to be built on the server

Standard library only. Requires Python 3.10+.

Usage:
  python3 hermes_console.py init        # interactive setup, writes console.env
  python3 hermes_console.py hash-password
  python3 hermes_console.py serve       # start the server (default)
"""
from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.0.0"
SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = Path(os.environ.get("CONSOLE_ENV", SCRIPT_DIR / "console.env"))

PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
ENV_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
TASK_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
PROTECTED_ENV_KEYS = {"API_SERVER_KEY", "API_SERVER_ENABLED", "API_SERVER_HOST", "API_SERVER_PORT"}
PROXY_PREFIXES = ("v1/", "api/sessions", "api/jobs", "api/model/options", "health")
FORWARD_REQUEST_HEADERS = ("content-type", "accept", "x-hermes-session-id", "x-hermes-session-key", "idempotency-key")
FORWARD_RESPONSE_HEADERS = ("content-type", "x-hermes-session-id", "x-hermes-session-key", "cache-control")
MAX_JSON_BYTES = 25 * 1024 * 1024
MAX_UPLOAD_BYTES = 512 * 1024 * 1024


# ── configuration ────────────────────────────────────────────────────────────

def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip().removeprefix("export ").strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    except FileNotFoundError:
        pass
    return values


def write_env_value(path: Path, key: str, value: str | None) -> None:
    """Set (or remove when value is None) KEY in a dotenv file, preserving other lines."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    out, found = [], False
    for line in lines:
        stripped = line.strip().removeprefix("export ").strip()
        if stripped.startswith(f"{key}="):
            found = True
            if value is not None:
                out.append(f"{key}={value}")
            continue
        out.append(line)
    if not found and value is not None:
        out.append(f"{key}={value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


class Config:
    def __init__(self) -> None:
        env = {**read_env_file(ENV_FILE), **{k: v for k, v in os.environ.items() if k.startswith(("CONSOLE_", "HERMES_", "FILES_"))}}
        self.username = env.get("CONSOLE_USERNAME", "")
        self.password_hash = env.get("CONSOLE_PASSWORD_HASH", "")
        self.password_plain = env.get("CONSOLE_PASSWORD", "")
        self.secret = env.get("CONSOLE_SECRET") or secrets.token_hex(32)
        self.host = env.get("CONSOLE_HOST", "0.0.0.0")
        self.port = int(env.get("CONSOLE_PORT", "8787"))
        self.token_ttl = int(env.get("CONSOLE_TOKEN_TTL_HOURS", "720")) * 3600
        self.cors_origins = [o.strip() for o in env.get("CONSOLE_CORS_ORIGINS", "*").split(",") if o.strip()]
        self.hermes_home = Path(os.path.expanduser(env.get("HERMES_HOME", "~/.hermes"))).resolve()
        self.hermes_bin = env.get("HERMES_BIN") or shutil.which("hermes") or os.path.expanduser("~/.local/bin/hermes")
        self.hermes_api = env.get("HERMES_API_URL", "http://127.0.0.1:8642").rstrip("/")
        self.workspace = Path(os.path.expanduser(env.get("CONSOLE_WORKSPACE", "~/hermes-workspace"))).resolve()
        extra_roots = [r.strip() for r in env.get("FILES_ROOTS", "").split(",") if r.strip()]
        self.extra_roots = [Path(os.path.expanduser(r)).resolve() for r in extra_roots]
        self.web_dist = Path(env.get("CONSOLE_WEB_DIST", SCRIPT_DIR.parent / "web" / "dist")).resolve()


CFG: Config


# ── auth ─────────────────────────────────────────────────────────────────────

PBKDF2_ITERATIONS = 390_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    if hasattr(hashlib, "scrypt"):
        digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
        return f"scrypt${salt.hex()}${digest.hex()}"
    # Some Python builds (e.g. LibreSSL) lack scrypt; PBKDF2 is always available.
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str) -> bool:
    stored = CFG.password_hash
    try:
        if stored.startswith("scrypt$"):
            _, salt_hex, digest_hex = stored.split("$")
            digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
            return hmac.compare_digest(digest.hex(), digest_hex)
        if stored.startswith("pbkdf2_sha256$"):
            _, iterations, salt_hex, digest_hex = stored.split("$")
            digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
            return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, AttributeError):
        return False
    if CFG.password_plain:
        return hmac.compare_digest(password.encode(), CFG.password_plain.encode())
    return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(username: str) -> tuple[str, int]:
    exp = int(time.time()) + CFG.token_ttl
    body = _b64(json.dumps({"u": username, "exp": exp}).encode())
    sig = _b64(hmac.new(CFG.secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", exp


def check_token(token: str) -> str | None:
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(CFG.secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp", 0) < time.time() or payload.get("u") != CFG.username:
            return None
        return payload["u"]
    except (ValueError, KeyError, json.JSONDecodeError):
        return None


_login_failures: dict[str, list[float]] = {}
_login_lock = threading.Lock()


def login_rate_limited(ip: str) -> bool:
    now = time.time()
    with _login_lock:
        attempts = [t for t in _login_failures.get(ip, []) if now - t < 300]
        _login_failures[ip] = attempts
        return len(attempts) >= 8


def record_login_failure(ip: str) -> None:
    with _login_lock:
        _login_failures.setdefault(ip, []).append(time.time())


# ── hermes helpers ───────────────────────────────────────────────────────────

class ApiError(Exception):
    def __init__(self, status: int, message: str, details: str = "") -> None:
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


def run_hermes(args: list[str], timeout: int = 120, profile: str | None = None) -> subprocess.CompletedProcess:
    cmd = [CFG.hermes_bin]
    if profile and profile != "default":
        cmd += ["-p", profile]
    cmd += args
    env = {**os.environ, "NO_COLOR": "1", "TERM": "dumb", "HERMES_HOME": str(CFG.hermes_home), "HERMES_NONINTERACTIVE": "1"}
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL, env=env)
    except FileNotFoundError:
        raise ApiError(500, f"Hermes CLI not found at {CFG.hermes_bin}. Set HERMES_BIN in console.env.")
    except subprocess.TimeoutExpired:
        raise ApiError(504, f"`hermes {' '.join(args)}` timed out after {timeout}s")


def run_hermes_ok(args: list[str], timeout: int = 120, profile: str | None = None) -> str:
    proc = run_hermes(args, timeout=timeout, profile=profile)
    if proc.returncode != 0:
        details = (proc.stderr or proc.stdout or "").strip()
        raise ApiError(400, details.splitlines()[-1] if details else f"hermes {args[0]} failed", details)
    return proc.stdout


def parse_json_output(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Some commands print a banner before the JSON document.
        for opener in ("[", "{"):
            idx = text.find(opener)
            if idx != -1:
                try:
                    return json.loads(text[idx:])
                except json.JSONDecodeError:
                    continue
    raise ApiError(502, "Could not parse JSON from Hermes CLI output", text[-2000:])


def profile_home(name: str) -> Path:
    if name == "default":
        return CFG.hermes_home
    if not PROFILE_RE.match(name):
        raise ApiError(400, "Invalid bot name. Use lowercase letters, digits, - and _.")
    return CFG.hermes_home / "profiles" / name


def list_profile_names() -> list[str]:
    names = ["default"]
    root = CFG.hermes_home / "profiles"
    if root.is_dir():
        for child in sorted(root.iterdir()):
            if child.is_dir() and PROFILE_RE.match(child.name) and ((child / "config.yaml").exists() or (child / ".env").exists()):
                names.append(child.name)
    return names


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        import yaml  # available when run with the Hermes virtualenv python
        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except ImportError:
        return _mini_yaml(text)
    except Exception:
        return {}


def _mini_yaml(text: str) -> dict:
    """Tiny fallback: nested mappings of scalars only (enough for model/terminal keys)."""
    root: dict = {}
    stack: list[tuple[int, dict]] = [(-1, root)]
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith(("#", "-")):
            continue
        indent = len(raw) - len(raw.lstrip())
        key, sep, value = raw.strip().partition(":")
        if not sep:
            continue
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1] if stack else root
        value = value.split(" #", 1)[0].strip()
        if value == "":
            child: dict = {}
            parent[key.strip()] = child
            stack.append((indent, child))
        else:
            parent[key.strip()] = value.strip("\"'")
    return root


def bot_summary(name: str) -> dict:
    home = profile_home(name)
    config = load_yaml(home / "config.yaml")
    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    terminal = config.get("terminal") if isinstance(config.get("terminal"), dict) else {}
    env = read_env_file(home / ".env")
    description = str(load_yaml(home / "profile.yaml").get("description") or "")  # Hermes profile metadata
    soul = home / "SOUL.md"
    return {
        "name": name,
        "is_default": name == "default",
        "home": str(home),
        "description": description,
        "model": (model.get("default") or model.get("model") or "") if isinstance(model, dict) else str(model or ""),
        "provider": (model.get("provider") or "") if isinstance(model, dict) else "",
        "base_url": (model.get("base_url") or "") if isinstance(model, dict) else "",
        "cwd": str(terminal.get("cwd") or ""),
        "has_soul": soul.exists(),
        "secrets": sorted(k for k in env if ENV_KEY_RE.match(k) and k not in PROTECTED_ENV_KEYS),
        "api_key_configured": bool(env.get("API_SERVER_KEY") or read_env_file(CFG.hermes_home / ".env").get("API_SERVER_KEY")),
    }


def hermes_key_for(profile: str) -> str:
    own = read_env_file(profile_home(profile) / ".env").get("API_SERVER_KEY")
    return own or read_env_file(CFG.hermes_home / ".env").get("API_SERVER_KEY", "") or os.environ.get("API_SERVER_KEY", "")


# ── file roots ───────────────────────────────────────────────────────────────

def file_roots() -> list[dict]:
    CFG.workspace.mkdir(parents=True, exist_ok=True)
    roots: list[tuple[str, Path]] = [("Workspace", CFG.workspace)]
    for label, sub in (("Hermes documents", "cache/documents"), ("Hermes images", "cache/images"),
                       ("Hermes audio", "cache/audio"), ("Schedule outputs", "cron/output")):
        roots.append((label, CFG.hermes_home / sub))
    home = Path.home().resolve()
    for name in list_profile_names()[1:]:
        base = CFG.hermes_home / "profiles" / name
        for label, sub in (("documents", "cache/documents"), ("images", "cache/images"), ("schedule outputs", "cron/output")):
            if (base / sub).is_dir():
                roots.append((f"{name} · {label}", base / sub))
    for name in list_profile_names():
        cwd = bot_summary(name)["cwd"]
        if cwd and cwd not in (".", "~"):
            path = Path(os.path.expanduser(cwd)).resolve()
            if path not in (home, Path("/")) and path.is_dir():
                roots.append((f"{name} working dir", path))
    for extra in CFG.extra_roots:
        roots.append((extra.name or str(extra), extra))
    seen, result = set(), []
    for label, path in roots:
        if path in seen:
            continue
        seen.add(path)
        result.append({"label": label, "path": str(path), "exists": path.is_dir()})
    return result


def resolve_safe_path(raw: str, must_exist: bool = True) -> Path:
    if not raw:
        raise ApiError(400, "path is required")
    path = Path(os.path.expanduser(raw)).resolve()
    for root in file_roots():
        root_path = Path(root["path"])
        if path == root_path or root_path in path.parents:
            if must_exist and not path.exists():
                raise ApiError(404, "File not found")
            return path
    raise ApiError(403, "Path is outside the allowed file roots")


def file_entry(path: Path) -> dict:
    try:
        st = path.stat()
    except OSError:
        return {"name": path.name, "path": str(path), "type": "missing", "size": 0, "mtime": 0}
    return {
        "name": path.name, "path": str(path), "type": "dir" if path.is_dir() else "file",
        "size": st.st_size, "mtime": int(st.st_mtime),
        "mime": None if path.is_dir() else (mimetypes.guess_type(path.name)[0] or "application/octet-stream"),
    }


# ── kanban ───────────────────────────────────────────────────────────────────

_kanban_ready = False


def kanban(args: list[str], timeout: int = 120) -> str:
    global _kanban_ready
    if not _kanban_ready:
        run_hermes(["kanban", "init"], timeout=60)
        _kanban_ready = True
    return run_hermes_ok(["kanban", *args], timeout=timeout)


def require_task_id(task_id: str) -> str:
    if not TASK_ID_RE.match(task_id):
        raise ApiError(400, "Invalid task id")
    return task_id


# ── HTTP handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = f"HermesConsole/{VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter logs, no query strings (tokens)
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")

    # ---- plumbing
    def cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin and ("*" in CFG.cors_origins or origin in CFG.cors_origins):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Hermes-Session-Id, X-Hermes-Session-Key, Idempotency-Key")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Hermes-Session-Id, Content-Disposition")
            self.send_header("Access-Control-Max-Age", "600")

    def send_json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit: int = MAX_JSON_BYTES) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ApiError(413, "Request body too large")
        return self.rfile.read(length) if length else b""

    def read_json(self) -> dict:
        raw = self.read_body()
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON body")
        if not isinstance(data, dict):
            raise ApiError(400, "JSON body must be an object")
        return data

    def query(self) -> dict[str, str]:
        return {k: v[-1] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}

    def authed(self, allow_query_token: bool = False) -> bool:
        header = self.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        if not token and allow_query_token:
            token = self.query().get("token", "")
        return bool(token and check_token(token))

    # ---- verbs
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        self.dispatch("GET")

    def do_POST(self) -> None:
        self.dispatch("POST")

    def do_PUT(self) -> None:
        self.dispatch("PUT")

    def do_PATCH(self) -> None:
        self.dispatch("PATCH")

    def do_DELETE(self) -> None:
        self.dispatch("DELETE")

    def dispatch(self, method: str) -> None:
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        try:
            if path.startswith("/api/"):
                self.route_api(method, path)
            elif method == "GET":
                self.serve_static(path)
            else:
                raise ApiError(404, "Not found")
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message, "details": exc.details})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # pragma: no cover - last-resort guard
            sys.stderr.write(f"Unhandled error: {exc!r}\n")
            try:
                self.send_json(500, {"error": "Internal server error", "details": str(exc)})
            except Exception:
                pass

    # ---- static web app
    def serve_static(self, path: str) -> None:
        dist = CFG.web_dist
        if not dist.is_dir():
            body = f"Hermes Console API is running, but the web app was not found at {dist}.".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        target = (dist / path.lstrip("/")).resolve()
        if dist not in target.parents and target != dist or not target.is_file():
            target = dist / "index.html"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        immutable = "/assets/" in path
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if immutable else "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---- API router
    def route_api(self, method: str, path: str) -> None:
        parts = [p for p in path.split("/") if p][1:]  # drop "api"
        if parts[:1] == ["console"]:
            parts = parts[1:]
        else:
            raise ApiError(404, "Not found")

        if parts == ["health"] and method == "GET":
            return self.send_json(200, {"ok": True, "app": "hermes-console", "version": VERSION})
        if parts == ["login"] and method == "POST":
            return self.handle_login()

        is_raw_file = parts == ["files", "raw"] and method == "GET"
        if not self.authed(allow_query_token=is_raw_file):
            raise ApiError(401, "Not authenticated")

        head = parts[0] if parts else ""
        if head == "me":
            return self.send_json(200, {"username": CFG.username, "version": VERSION})
        if head == "hermes":
            return self.proxy_hermes(method, parts[1:])
        if head == "bots":
            return self.route_bots(method, parts[1:])
        if head == "tasks":
            return self.route_tasks(method, parts[1:])
        if head == "files":
            return self.route_files(method, parts[1:])
        if head == "system":
            return self.route_system(method, parts[1:])
        raise ApiError(404, "Not found")

    def handle_login(self) -> None:
        ip = self.client_address[0]
        if login_rate_limited(ip):
            raise ApiError(429, "Too many failed attempts. Try again in a few minutes.")
        body = self.read_json()
        username = str(body.get("username", ""))
        password = str(body.get("password", ""))
        if not CFG.username or not (CFG.password_hash or CFG.password_plain):
            raise ApiError(503, "Console is not configured. Run: python3 hermes_console.py init")
        if not (hmac.compare_digest(username, CFG.username) and verify_password(password)):
            record_login_failure(ip)
            time.sleep(0.6)
            raise ApiError(401, "Invalid username or password")
        token, exp = issue_token(username)
        self.send_json(200, {"token": token, "expires_at": exp, "username": username})

    # ---- proxy to the Hermes API server
    def proxy_hermes(self, method: str, parts: list[str]) -> None:
        if len(parts) < 2:
            raise ApiError(404, "Usage: /api/console/hermes/<bot>/<path>")
        bot, rest = parts[0], "/".join(parts[1:])
        profile_home(bot)  # validates the name
        if not rest.startswith(PROXY_PREFIXES):
            raise ApiError(403, "This Hermes endpoint is not exposed by the console")
        key = hermes_key_for(bot)
        if not key:
            raise ApiError(503, "API_SERVER_KEY is not set in ~/.hermes/.env — enable the Hermes API server first.")
        upstream = urllib.parse.urlsplit(CFG.hermes_api)
        target = ("" if bot == "default" else f"/p/{bot}") + "/" + urllib.parse.quote(rest)
        query = urllib.parse.urlsplit(self.path).query
        if query:
            target += "?" + query
        body = self.read_body() if method in ("POST", "PUT", "PATCH", "DELETE") else None
        headers = {"Authorization": f"Bearer {key}"}
        for name in FORWARD_REQUEST_HEADERS:
            if self.headers.get(name):
                headers[name] = self.headers[name]
        conn_cls = http.client.HTTPSConnection if upstream.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(upstream.hostname, upstream.port or (443 if upstream.scheme == "https" else 80), timeout=3600)
        try:
            conn.request(method, (upstream.path.rstrip("/") + target), body=body, headers=headers)
            resp = conn.getresponse()
        except OSError as exc:
            conn.close()
            raise ApiError(502, f"Cannot reach Hermes API server at {CFG.hermes_api}. Is `hermes gateway` running?", str(exc))

        streaming = "text/event-stream" in (resp.getheader("Content-Type") or "")
        self.send_response(resp.status)
        for name in FORWARD_RESPONSE_HEADERS:
            if resp.getheader(name):
                self.send_header(name, resp.getheader(name))
        self.cors_headers()
        try:
            if streaming:
                self.send_header("X-Accel-Buffering", "no")
                self.send_header("Connection", "close")
                self.close_connection = True
                self.end_headers()
                while True:
                    chunk = resp.read1(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            else:
                data = resp.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        finally:
            conn.close()

    # ---- bots (Hermes profiles)
    def route_bots(self, method: str, parts: list[str]) -> None:
        if not parts:
            if method == "GET":
                return self.send_json(200, {"bots": [bot_summary(n) for n in list_profile_names()]})
            if method == "POST":
                return self.create_bot(self.read_json())
            raise ApiError(405, "Method not allowed")

        name = parts[0]
        home = profile_home(name)
        if not home.is_dir():
            raise ApiError(404, f"Bot '{name}' not found")
        sub = parts[1] if len(parts) > 1 else ""

        if sub == "" and method == "GET":
            data = bot_summary(name)
            soul = home / "SOUL.md"
            data["soul"] = soul.read_text(encoding="utf-8", errors="replace") if soul.exists() else ""
            return self.send_json(200, data)
        if sub == "" and method == "PATCH":
            return self.update_bot(name, home, self.read_json())
        if sub == "" and method == "DELETE":
            if name == "default":
                raise ApiError(400, "The default bot cannot be deleted")
            run_hermes_ok(["profile", "delete", name, "--yes"], timeout=120)
            return self.send_json(200, {"deleted": name})
        if sub == "secrets" and method == "PUT":
            body = self.read_json()
            key = str(body.get("key", "")).strip()
            if not ENV_KEY_RE.match(key) or key in PROTECTED_ENV_KEYS:
                raise ApiError(400, "Invalid or protected variable name")
            value = body.get("value")
            write_env_value(home / ".env", key, None if value in (None, "") else str(value).replace("\n", ""))
            return self.send_json(200, bot_summary(name))
        raise ApiError(404, "Not found")

    def create_bot(self, body: dict) -> None:
        name = str(body.get("name", "")).strip().lower()
        if not PROFILE_RE.match(name) or name == "default":
            raise ApiError(400, "Bot name must match [a-z0-9][a-z0-9_-]{0,63}")
        if profile_home(name).exists():
            raise ApiError(409, f"Bot '{name}' already exists")
        args = ["profile", "create", name]
        if body.get("description"):
            args += ["--description", str(body["description"])]
        if body.get("clone"):
            args.append("--clone")
        run_hermes_ok(args, timeout=180)
        workspace = CFG.workspace / name
        workspace.mkdir(parents=True, exist_ok=True)
        updates = {"cwd": str(workspace), **{k: body[k] for k in ("model", "provider", "soul") if body.get(k)}}
        self.update_bot(name, profile_home(name), updates, respond=False)
        self.send_json(201, bot_summary(name))

    def update_bot(self, name: str, home: Path, body: dict, respond: bool = True) -> None:
        config_keys = {"model": "model.default", "provider": "model.provider", "base_url": "model.base_url", "cwd": "terminal.cwd"}
        for field, key in config_keys.items():
            if field in body and body[field] is not None:
                value = str(body[field]).strip()
                run_hermes_ok(["config", "set", key, value], timeout=60, profile=name)
        if "soul" in body and body["soul"] is not None:
            (home / "SOUL.md").write_text(str(body["soul"]), encoding="utf-8")
        if respond:
            self.send_json(200, bot_summary(name))

    # ---- kanban tasks
    def route_tasks(self, method: str, parts: list[str]) -> None:
        if not parts:
            if method == "GET":
                q = self.query()
                args = ["list", "--json"]
                if q.get("archived") == "1":
                    args.append("--archived")
                data = parse_json_output(kanban(args))
                tasks = data.get("tasks", data) if isinstance(data, dict) else data
                return self.send_json(200, {"tasks": tasks if isinstance(tasks, list) else []})
            if method == "POST":
                body = self.read_json()
                title = str(body.get("title", "")).strip()
                if not title:
                    raise ApiError(400, "Title is required")
                args = ["create", title, "--json"]
                if body.get("body"):
                    args += ["--body", str(body["body"])]
                if body.get("assignee"):
                    args += ["--assignee", str(body["assignee"])]
                if body.get("priority") not in (None, ""):
                    args += ["--priority", str(int(body["priority"]))]
                if body.get("triage"):
                    args.append("--triage")
                if body.get("goal"):
                    args.append("--goal")
                for skill in body.get("skills") or []:
                    args += ["--skill", str(skill)]
                if body.get("workspace"):
                    args += ["--workspace", str(body["workspace"])]
                else:
                    args += ["--workspace", f"dir:{CFG.workspace}"]
                out = kanban(args)
                try:
                    created = parse_json_output(out)
                except ApiError:
                    created = {"output": out}
                return self.send_json(201, {"task": created})
            raise ApiError(405, "Method not allowed")

        if parts == ["stats"] and method == "GET":
            return self.send_json(200, parse_json_output(kanban(["stats", "--json"])))
        if parts == ["dispatch"] and method == "POST":
            proc = run_hermes(["kanban", "dispatch", "--json"], timeout=120)
            return self.send_json(200, {"ok": proc.returncode == 0, "output": (proc.stdout + proc.stderr).strip()})

        task_id = require_task_id(parts[0])
        action = parts[1] if len(parts) > 1 else ""
        if action == "" and method == "GET":
            return self.send_json(200, {"task": parse_json_output(kanban(["show", task_id, "--json"]))})
        if action == "log" and method == "GET":
            proc = run_hermes(["kanban", "log", task_id, "--tail", "60000"], timeout=60)
            return self.send_json(200, {"log": (proc.stdout or proc.stderr).strip()})
        if method != "POST":
            raise ApiError(405, "Method not allowed")
        body = self.read_json()
        text = str(body.get("text", "")).strip()
        if action == "comment":
            if not text:
                raise ApiError(400, "Comment text is required")
            kanban(["comment", task_id, text, "--author", CFG.username or "console"])
        elif action == "complete":
            kanban(["complete", task_id, *(["--result", text] if text else [])])
        elif action == "block":
            kanban(["block", task_id, text or "Blocked from Hermes Console"])
        elif action in ("unblock", "archive", "promote"):
            kanban([action, task_id])
        elif action == "assign":
            kanban(["assign", task_id, str(body.get("assignee") or "none")])
        elif action == "edit":
            args = ["edit", task_id]
            for field in ("title", "body"):
                if body.get(field) is not None:
                    args += [f"--{field}", str(body[field])]
            if body.get("priority") not in (None, ""):
                args += ["--priority", str(int(body["priority"]))]
            kanban(args)
        else:
            raise ApiError(404, "Unknown task action")
        self.send_json(200, {"ok": True})

    # ---- files
    def route_files(self, method: str, parts: list[str]) -> None:
        q = self.query()
        sub = parts[0] if parts else ""
        if sub == "roots" and method == "GET":
            return self.send_json(200, {"roots": file_roots()})
        if sub == "" and method == "GET":
            path = resolve_safe_path(q.get("path", ""))
            if not path.is_dir():
                return self.send_json(200, {"entry": file_entry(path)})
            show_hidden = q.get("hidden") == "1"
            entries = [file_entry(p) for p in path.iterdir() if show_hidden or not p.name.startswith(".")]
            entries.sort(key=lambda e: (e["type"] != "dir", -e["mtime"] if q.get("sort") == "recent" else 0, e["name"].lower()))
            return self.send_json(200, {"path": str(path), "entries": entries})
        if sub == "recent" and method == "GET":
            return self.send_json(200, {"entries": self.recent_files(int(q.get("limit", "60")))})
        if sub == "raw" and method == "GET":
            return self.send_file(resolve_safe_path(q.get("path", "")), download=q.get("download") == "1")
        if sub == "upload" and method in ("PUT", "POST"):
            directory = resolve_safe_path(q.get("dir", ""))
            name = os.path.basename(q.get("name", "")).strip()
            if not directory.is_dir() or not name or name in (".", ".."):
                raise ApiError(400, "Valid dir and name are required")
            target = resolve_safe_path(str(directory / name), must_exist=False)
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_UPLOAD_BYTES:
                raise ApiError(413, "File too large")
            remaining = length
            with open(target, "wb") as fh:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    fh.write(chunk)
                    remaining -= len(chunk)
            return self.send_json(201, {"entry": file_entry(target)})
        if sub == "mkdir" and method == "POST":
            target = resolve_safe_path(str(self.read_json().get("path", "")), must_exist=False)
            target.mkdir(parents=True, exist_ok=True)
            return self.send_json(201, {"entry": file_entry(target)})
        if sub == "" and method == "DELETE":
            target = resolve_safe_path(q.get("path", ""))
            if any(str(target) == r["path"] for r in file_roots()):
                raise ApiError(400, "Root folders cannot be deleted")
            shutil.rmtree(target) if target.is_dir() else target.unlink()
            return self.send_json(200, {"deleted": str(target)})
        raise ApiError(404, "Not found")

    def recent_files(self, limit: int) -> list[dict]:
        found: list[dict] = []
        deadline = time.time() + 3
        for root in file_roots():
            base = Path(root["path"])
            if not base.is_dir():
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in ("node_modules", "__pycache__", "venv", ".git")]
                for fname in filenames:
                    if not fname.startswith("."):
                        found.append(file_entry(Path(dirpath) / fname))
                if time.time() > deadline or len(found) > 20000:
                    break
        found.sort(key=lambda e: -e["mtime"])
        return found[:max(1, min(limit, 500))]

    def send_file(self, path: Path, download: bool) -> None:
        if not path.is_file():
            raise ApiError(400, "Not a file")
        size = path.stat().st_size
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(size))
        disposition = "attachment" if download else "inline"
        self.send_header("Content-Disposition", f"{disposition}; filename*=UTF-8''{urllib.parse.quote(path.name)}")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if mime in ("text/html", "image/svg+xml", "application/xhtml+xml"):
            self.send_header("Content-Security-Policy", "sandbox")
        self.cors_headers()
        self.end_headers()
        with open(path, "rb") as fh:
            shutil.copyfileobj(fh, self.wfile, 1 << 20)

    # ---- system
    def route_system(self, method: str, parts: list[str]) -> None:
        sub = parts[0] if parts else ""
        if sub == "info" and method == "GET":
            health = {"reachable": False}
            try:
                u = urllib.parse.urlsplit(CFG.hermes_api)
                conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=3)
                conn.request("GET", "/health")
                r = conn.getresponse()
                health = {"reachable": True, "status": r.status, "body": r.read(2000).decode(errors="replace")}
                conn.close()
            except OSError as exc:
                health["error"] = str(exc)
            gateway = load_yaml(CFG.hermes_home / "config.yaml").get("gateway") or {}
            return self.send_json(200, {
                "console_version": VERSION, "hermes_home": str(CFG.hermes_home), "hermes_bin": CFG.hermes_bin,
                "hermes_api": CFG.hermes_api, "api_health": health, "workspace": str(CFG.workspace),
                "multiplex_profiles": bool(isinstance(gateway, dict) and str(gateway.get("multiplex_profiles")).lower() == "true"),
                "api_key_configured": bool(hermes_key_for("default")),
            })
        commands = {
            "version": (["--version"], 30),
            "status": (["gateway", "status"], 60),
            "doctor": (["doctor"], 180),
            "restart": (["gateway", "restart"], 120),
            "profiles": (["profile", "list"], 60),
            "update": (["update"], 900),
        }
        if sub == "run" and method == "POST":
            action = str(self.read_json().get("action", ""))
            if action not in commands:
                raise ApiError(400, f"Unknown action. Allowed: {', '.join(commands)}")
            args, timeout = commands[action]
            proc = run_hermes(args, timeout=timeout)
            return self.send_json(200, {"action": action, "exit_code": proc.returncode, "output": (proc.stdout + ("\n" + proc.stderr if proc.stderr else "")).strip()})
        raise ApiError(404, "Not found")


# ── CLI ──────────────────────────────────────────────────────────────────────

def cmd_init() -> None:
    print("Hermes Console setup\n")
    existing = read_env_file(ENV_FILE)
    username = input(f"Username [{existing.get('CONSOLE_USERNAME', 'admin')}]: ").strip() or existing.get("CONSOLE_USERNAME", "admin")
    while True:
        password = getpass.getpass("Password (min 10 chars): ")
        if len(password) >= 10 and password == getpass.getpass("Repeat password: "):
            break
        print("Passwords did not match or are too short. Try again.")
    port = input(f"Port [{existing.get('CONSOLE_PORT', '8787')}]: ").strip() or existing.get("CONSOLE_PORT", "8787")
    values = {
        "CONSOLE_USERNAME": username,
        "CONSOLE_PASSWORD_HASH": hash_password(password),
        "CONSOLE_SECRET": existing.get("CONSOLE_SECRET") or secrets.token_hex(32),
        "CONSOLE_PORT": port,
        "CONSOLE_HOST": existing.get("CONSOLE_HOST", "0.0.0.0"),
    }
    for key, value in values.items():
        write_env_value(ENV_FILE, key, value)
    write_env_value(ENV_FILE, "CONSOLE_PASSWORD", None)
    hermes_env = Path(os.path.expanduser("~/.hermes/.env"))
    if not read_env_file(hermes_env).get("API_SERVER_KEY"):
        if input("\nAPI_SERVER_KEY is not set in ~/.hermes/.env. Create one and enable the API server? [Y/n]: ").strip().lower() != "n":
            write_env_value(hermes_env, "API_SERVER_ENABLED", "true")
            write_env_value(hermes_env, "API_SERVER_KEY", secrets.token_hex(32))
            print("Done. Restart Hermes with: hermes gateway restart")
    print(f"\nSaved {ENV_FILE}. Start with: python3 {Path(__file__).name} serve")


def main() -> None:
    global CFG
    command = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if command == "init":
        return cmd_init()
    if command == "hash-password":
        print(hash_password(getpass.getpass("Password: ")))
        return
    if command not in ("serve", "run"):
        print(__doc__)
        sys.exit(1)
    CFG = Config()
    if not CFG.username:
        print("Console is not configured yet. Run: python3 hermes_console.py init", file=sys.stderr)
        sys.exit(1)
    CFG.workspace.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((CFG.host, CFG.port), Handler)
    server.daemon_threads = True
    print(f"Hermes Console {VERSION} on http://{CFG.host}:{CFG.port}  (Hermes API: {CFG.hermes_api}, home: {CFG.hermes_home})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

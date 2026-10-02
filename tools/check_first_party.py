#!/usr/bin/env python3
"""First-party gate for site-owned pages. Published science copies have their own source gate.

Static checks inspect loading positions; the browser check intercepts every request before
transmission. The browser also exercises the site's expandable content and local viewer.
"""
import argparse
import asyncio
import contextlib
from html.parser import HTMLParser
import http.server
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
REMOTE = re.compile(r"^(?:https?:)?//", re.I)
CSS_LOAD = re.compile(r"(?:url\(\s*|@import\s+)[\"']?((?:https?:)?//[^\s\"')]+)", re.I)
JS_LOAD = re.compile(
    r"(?:\b(?:fetch|import|importScripts|[W]orker|Shared[W]orker|WebSocket|EventSource|sendBeacon)\s*\(\s*"
    r"|\bopen\s*\(\s*[\"'][^\"']*[\"']\s*,\s*"
    r"|\.(?:src|href|poster)\s*=\s*)[\"'`]?((?:https?:)?//[^\s\"'`<>)]+)", re.I)
TEXT_SUFFIXES = {".html", ".css", ".js", ".mjs", ".json", ".svg", ".webmanifest", ".txt"}


def own_files():
    return sorted(p for p in SITE.rglob("*") if p.is_file()
                  and p.suffix in TEXT_SUFFIXES
                  and p.relative_to(SITE).parts[0] not in {"airships", "airship3d"})


class LoadingHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.findings = []
        self.block = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        line = self.getpos()[0]
        if tag in {"script", "style"}:
            self.block = tag
        for name, value in attrs.items():
            if not value or not REMOTE.search(value.strip()) and name != "srcset":
                continue
            if tag in {"a", "area", "base"} and name == "href":
                continue
            if tag == "link" and name == "href" and attrs.get("rel", "").lower() in {"canonical", "alternate"}:
                continue
            if tag == "meta" and name == "content" and attrs.get("property", "").startswith("og:"):
                continue
            if name in {"src", "href", "xlink:href", "poster", "data", "action", "ping", "srcset"}:
                urls = re.findall(r"(?:https?:)?//[^\s,]+", value) if name == "srcset" else [value]
                for url in urls:
                    if REMOTE.match(url):
                        self.findings.append((line, f"{tag}[{name}]={url}"))
        if tag == "meta" and attrs.get("http-equiv", "").lower() == "refresh":
            if re.search(r"url\s*=\s*[\"']?(?:https?:)?//", attrs.get("content", ""), re.I):
                self.findings.append((line, "external meta refresh"))

    def handle_endtag(self, tag):
        if tag == self.block:
            self.block = None

    def handle_data(self, data):
        if self.block in {"script", "style"}:
            for line, reason in text_loads(data, self.block):
                self.findings.append((self.getpos()[0] + line - 1, reason))


def text_loads(data, kind):
    pattern = CSS_LOAD if kind == "style" else JS_LOAD
    return [(data.count("\n", 0, m.start()) + 1, m.group(1)) for m in pattern.finditer(data)]


def violations(data, suffix):
    if suffix == ".html":
        parser = LoadingHTML()
        parser.feed(data)
        return parser.findings
    if suffix == ".css":
        return text_loads(data, "style")
    if suffix in {".js", ".mjs"}:
        return text_loads(data, "script")
    if suffix == ".svg":
        parser = LoadingHTML()
        parser.feed(data)
        return parser.findings
    return []


def static_check():
    files = own_files()
    findings = [(str(p.relative_to(ROOT)), line, reason)
                for p in files for line, reason in violations(p.read_text(), p.suffix)]
    for path, line, reason in findings:
        print(f"{path}:{line}: external load: {reason}")
    print(f"firstparty static: {len(files)} site-owned text files; {len(findings)} external loads")
    return findings


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Browser:
    def __init__(self, ws, origin):
        self.ws, self.origin = ws, origin
        self.seq, self.pending = 0, {}
        self.requests = []
        self.loaded = asyncio.Event()
        self.reader = asyncio.create_task(self.receive())

    def foreign(self, url):
        parts = urlsplit(url)
        return parts.scheme not in {"data", "blob", "about"} and (
            parts.scheme, parts.netloc) != ("http", self.origin)

    async def send(self, method, params=None, wait=True):
        self.seq += 1
        mid = self.seq
        future = asyncio.get_running_loop().create_future() if wait else None
        if future:
            self.pending[mid] = future
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        if future:
            return await asyncio.wait_for(future, 30)

    async def receive(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg:
                future = self.pending.pop(msg["id"], None)
                if future and not future.done():
                    if "error" in msg:
                        future.set_exception(RuntimeError(str(msg["error"])))
                    else:
                        future.set_result(msg.get("result", {}))
                continue
            method, params = msg.get("method"), msg.get("params", {})
            if method in {"Network.requestWillBeSent", "Network.webSocketCreated"}:
                url = params.get("request", {}).get("url", params.get("url", ""))
                self.requests.append((url, self.foreign(url)))
            elif method == "Fetch.requestPaused":
                rid = params["requestId"]
                if self.foreign(params["request"]["url"]):
                    await self.send("Fetch.failRequest", {"requestId": rid, "errorReason": "BlockedByClient"}, False)
                else:
                    await self.send("Fetch.continueRequest", {"requestId": rid}, False)
            elif method == "Page.loadEventFired":
                self.loaded.set()

    async def evaluate(self, expression):
        result = await self.send("Runtime.evaluate", {"expression": expression, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise RuntimeError(str(result["exceptionDetails"]))

    async def navigate(self, url):
        self.requests.clear()
        self.loaded.clear()
        await self.send("Page.navigate", {"url": url})
        await asyncio.wait_for(self.loaded.wait(), 25)


async def browse(ws_url, origin):
    import websockets
    async with websockets.connect(ws_url, max_size=32_000_000) as ws:
        browser = Browser(ws, origin)
        try:
            for domain in ("Page", "Runtime", "Network"):
                await browser.send(domain + ".enable")
            await browser.send("Fetch.enable", {"patterns": [{"urlPattern": "*"}]})
            # A local positive control proves the intercept is armed before any site page.
            await browser.navigate(f"http://{origin}/")
            await browser.evaluate("new Image().src='https://firstparty-test.invalid/probe.png'")
            await asyncio.sleep(.2)
            if not any(foreign and "firstparty-test.invalid" in url for url, foreign in browser.requests):
                raise RuntimeError("CDP missed the external-image control")
            print("firstparty browser control: external image observed and blocked")
            failures = []
            pages = [p for p in own_files() if p.name == "index.html"]
            for path in pages:
                rel = path.relative_to(SITE).as_posix()
                for width, height in ((1440, 900), (390, 844)):
                    await browser.send("Emulation.setDeviceMetricsOverride", {
                        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": width == 390})
                    await browser.navigate(f"http://{origin}/{rel}")
                    await browser.evaluate("""new Promise(async r => {
                      document.querySelectorAll('details').forEach(d => d.open=true);
                      for(let y=0;y<document.body.scrollHeight;y+=700){scrollTo(0,y);await new Promise(q=>setTimeout(q,75));}
                      scrollTo(0,0); setTimeout(r,700);
                    })""")
                    if rel == "index.html":
                        await asyncio.sleep(8)  # the front-page viewer starts after the first paint
                        await browser.evaluate("document.querySelector('#pinkmark')?.click()")
                    bad = sorted({url for url, foreign in browser.requests if foreign})
                    print(f"{rel} {width}px: {len(browser.requests)} requests; {len(bad)} external")
                    failures.extend((rel, width, url) for url in bad)
            for rel, width, url in failures:
                print(f"FOREIGN {rel} {width}px {url}")
            return failures
        finally:
            browser.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await browser.reader


def browser_check():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    scratch = Path(os.environ.get("TMPDIR", ""))
    if not scratch.is_dir():
        raise RuntimeError("TMPDIR must be an existing scratch directory")
    try:
        with tempfile.TemporaryDirectory(dir=scratch) as tmp:
            port = free_port()
            proc = subprocess.Popen([
                os.environ.get("CHROME", "/snap/bin/chromium"), "--headless=new", "--no-sandbox",
                "--disable-gpu", "--disable-background-networking", "--no-first-run",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
                f"--remote-debugging-port={port}", f"--user-data-dir={tmp}/profile", "about:blank"
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    try:
                        tabs = json.load(urlopen(f"http://127.0.0.1:{port}/json", timeout=1))
                        ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
                        break
                    except Exception:
                        import time
                        time.sleep(.2)
                else:
                    raise RuntimeError("Chromium did not expose a page")
                return asyncio.run(browse(ws_url, f"127.0.0.1:{server.server_port}"))
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--static-only", action="store_true")
    options = args.parse_args()
    findings = static_check()
    if not options.static_only and not findings:
        findings += browser_check()
    raise SystemExit(bool(findings))

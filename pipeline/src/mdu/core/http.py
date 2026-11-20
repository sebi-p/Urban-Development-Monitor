"""The only way the pipeline talks to the outside world (CLAUDE.md, PLAN §7 "Politeness rules").

Every request goes through :class:`PoliteClient`, which:

- checks robots.txt for each host (RFC 9309: a 4xx means "allowed", a 5xx or network error means
  "assume everything is disallowed for now") and refuses disallowed paths;
- refuses hosts the jurisdiction config marks as off-limits;
- waits at least ``min_interval`` seconds between requests to the same host;
- identifies the project and a contact address in the User-Agent;
- retries 429/5xx/timeouts with exponential back-off, honouring ``Retry-After``;
- supports conditional GET (ETag / Last-Modified);
- aborts downloads larger than ``max_bytes``;
- stops after ``max_consecutive_errors`` failed requests in a row.
"""

from __future__ import annotations

import time
import urllib.robotparser
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from urllib.parse import urljoin, urlsplit

import httpx

from mdu import __version__

PROJECT_URL = "https://urban-development-monitor.vercel.app"
CONTACT = "urban-development-monitor@pm.me"
USER_AGENT = f"MonitorDezvoltareUrbana/{__version__} (+{PROJECT_URL}; {CONTACT})"

ROBOTS_TTL_SECONDS = 24 * 3600
ROBOTS_UNREACHABLE_TTL_SECONDS = 600
MAX_REDIRECTS = 5
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
# A missing page is an answer, not a failure: it doesn't count towards max_consecutive_errors.
NOT_FOUND_STATUSES = frozenset({404, 410})
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


class HttpError(Exception):
    """Base class for errors raised by the polite client."""


class Blocked(HttpError):
    """The URL may not be fetched (robots.txt, blocked host, or robots.txt unreachable)."""


class TooLarge(HttpError):
    """The response body exceeded ``max_bytes``."""


class TooManyErrors(HttpError):
    """Too many consecutive failures; the caller should stop and alert."""


class FetchFailed(HttpError):
    """The request still failed after all retries."""

    def __init__(self, url: str, reason: str) -> None:
        super().__init__(f"{url}: {reason}")
        self.url = url
        self.reason = reason


@dataclass(frozen=True)
class Response:
    url: str
    status: int
    headers: dict[str, str]
    content: bytes

    @property
    def not_modified(self) -> bool:
        return self.status == HTTPStatus.NOT_MODIFIED

    @property
    def etag(self) -> str | None:
        return self.headers.get("etag")

    @property
    def last_modified(self) -> str | None:
        return self.headers.get("last-modified")

    @property
    def content_type(self) -> str | None:
        return self.headers.get("content-type")

    @property
    def content_length(self) -> int | None:
        raw = self.headers.get("content-length")
        return int(raw) if raw and raw.isdigit() else None


@dataclass
class _Robots:
    parser: urllib.robotparser.RobotFileParser | None  # None = allow everything
    unreachable: bool
    fetched_at: float


@dataclass
class PoliteClient:
    min_interval: float = 2.5
    max_retries: int = 4
    backoff_base: float = 2.0
    max_backoff: float = 120.0
    max_consecutive_errors: int = 20
    max_bytes: int = 50 * 1024 * 1024
    timeout: float = 30.0
    user_agent: str = USER_AGENT
    blocked_hosts: Iterable[str] = ()
    transport: httpx.BaseTransport | None = None
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic

    _client: httpx.Client = field(init=False, repr=False)
    _last_request: dict[str, float] = field(init=False, default_factory=dict, repr=False)
    _robots: dict[str, _Robots] = field(init=False, default_factory=dict, repr=False)
    _consecutive_errors: int = field(init=False, default=0, repr=False)
    _blocked: frozenset[str] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._blocked = frozenset(h.lower() for h in self.blocked_hosts)
        self._client = httpx.Client(
            headers={"User-Agent": self.user_agent, "Accept-Language": "ro,en;q=0.5"},
            timeout=self.timeout,
            # Redirects are followed by hand so every hop is checked and throttled.
            follow_redirects=False,
            http2=self.transport is None,
            transport=self.transport,
        )

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    # Public API

    def get(
        self, url: str, *, etag: str | None = None, last_modified: str | None = None
    ) -> Response:
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        return self._request("GET", url, headers)

    def head(self, url: str) -> Response:
        return self._request("HEAD", url, {})

    def allowed(self, url: str) -> bool:
        """Whether robots.txt and the host block list allow fetching ``url``."""
        try:
            self._check_allowed(url)
        except Blocked:
            return False
        return True

    # Internals

    def _check_allowed(self, url: str) -> None:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise Blocked(f"{url}: not an http(s) URL")
        host = parts.hostname.lower()
        if host in self._blocked:
            raise Blocked(f"{url}: host {host} is off-limits (jurisdiction config)")
        robots = self._robots_for(parts.scheme, parts.netloc)
        if robots.unreachable:
            raise Blocked(f"{url}: robots.txt for {host} is unreachable; assuming disallowed")
        if robots.parser and not robots.parser.can_fetch(self.user_agent, url):
            raise Blocked(f"{url}: disallowed by robots.txt")

    def _robots_for(self, scheme: str, netloc: str) -> _Robots:
        key = f"{scheme}://{netloc}"
        cached = self._robots.get(key)
        if cached:
            ttl = ROBOTS_UNREACHABLE_TTL_SECONDS if cached.unreachable else ROBOTS_TTL_SECONDS
            if self.clock() - cached.fetched_at < ttl:
                return cached

        robots_url = f"{key}/robots.txt"
        try:
            resp = self._send("GET", robots_url, {}, retries=1)
            for _ in range(MAX_REDIRECTS):  # RFC 9309: follow at least five redirects
                location = resp.headers.get("location")
                if resp.status not in REDIRECT_STATUSES or not location:
                    break
                resp = self._send("GET", urljoin(robots_url, location), {}, retries=1)
        except (FetchFailed, TooLarge):
            entry = _Robots(parser=None, unreachable=True, fetched_at=self.clock())
        else:
            if HTTPStatus.BAD_REQUEST <= resp.status < HTTPStatus.INTERNAL_SERVER_ERROR:
                entry = _Robots(parser=None, unreachable=False, fetched_at=self.clock())
            elif resp.status >= HTTPStatus.INTERNAL_SERVER_ERROR:
                entry = _Robots(parser=None, unreachable=True, fetched_at=self.clock())
            else:
                parser = urllib.robotparser.RobotFileParser(robots_url)
                text = resp.content.decode("utf-8", errors="replace")
                # Some sites answer /robots.txt with an HTML 404 page and status 200.
                if "<html" in text[:500].lower():
                    entry = _Robots(parser=None, unreachable=False, fetched_at=self.clock())
                else:
                    parser.parse(text.splitlines())
                    entry = _Robots(parser=parser, unreachable=False, fetched_at=self.clock())
        self._robots[key] = entry
        return entry

    def _request(self, method: str, url: str, headers: dict[str, str]) -> Response:
        if self._consecutive_errors >= self.max_consecutive_errors:
            raise TooManyErrors(f"{self._consecutive_errors} consecutive failures; stopping")
        try:
            resp = self._follow(method, url, headers)
        except (FetchFailed, TooLarge):
            self._consecutive_errors += 1
            raise
        if resp.status >= HTTPStatus.BAD_REQUEST and resp.status not in NOT_FOUND_STATUSES:
            self._consecutive_errors += 1
        else:
            self._consecutive_errors = 0
        return resp

    def _follow(self, method: str, url: str, headers: dict[str, str]) -> Response:
        for _ in range(MAX_REDIRECTS + 1):
            self._check_allowed(url)
            resp = self._send(method, url, headers, retries=self.max_retries)
            location = resp.headers.get("location")
            if resp.status not in REDIRECT_STATUSES or not location:
                return resp
            url = urljoin(url, location)
            if resp.status == HTTPStatus.SEE_OTHER:
                method = "GET"
        raise FetchFailed(url, f"more than {MAX_REDIRECTS} redirects")

    def _throttle(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            wait = self.min_interval - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last_request[host] = self.clock()

    def _send(self, method: str, url: str, headers: dict[str, str], *, retries: int) -> Response:
        host = (urlsplit(url).hostname or "").lower()
        attempt = 0
        while True:
            self._throttle(host)
            try:
                resp = self._stream(method, url, headers)
            except httpx.TransportError as exc:
                reason = f"{type(exc).__name__}: {exc}"
                retry_after = None
            else:
                if resp.status not in RETRY_STATUSES:
                    return resp
                reason = f"HTTP {resp.status}"
                retry_after = _retry_after_seconds(resp.headers.get("retry-after"))
                if attempt >= retries:
                    return resp
            if attempt >= retries:
                raise FetchFailed(url, reason)
            backoff = min(self.max_backoff, self.backoff_base * 2**attempt)
            self.sleep(max(backoff, retry_after or 0))
            attempt += 1

    def _stream(self, method: str, url: str, headers: dict[str, str]) -> Response:
        with self._client.stream(method, url, headers=headers) as r:
            declared = r.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > self.max_bytes:
                raise TooLarge(f"{url}: {declared} bytes > {self.max_bytes}")
            chunks: list[bytes] = []
            size = 0
            if method != "HEAD":
                for chunk in r.iter_bytes():
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise TooLarge(f"{url}: more than {self.max_bytes} bytes")
                    chunks.append(chunk)
            return Response(
                url=str(r.url),
                status=r.status_code,
                headers={k.lower(): v for k, v in r.headers.items()},
                content=b"".join(chunks),
            )


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    if value.strip().isdigit():
        return float(value.strip())
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, when.timestamp() - time.time())

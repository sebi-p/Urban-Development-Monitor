"""PoliteClient tests. No network: every response comes from an httpx.MockTransport."""

from collections.abc import Callable

import httpx
import pytest

from mdu.core.http import (
    USER_AGENT,
    Blocked,
    FetchFailed,
    PoliteClient,
    TooLarge,
    TooManyErrors,
)

Handler = Callable[[httpx.Request], httpx.Response]


class FakeTime:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def make_client(
    handler: Handler, **kwargs: object
) -> tuple[PoliteClient, FakeTime, list[httpx.Request]]:
    t = FakeTime()
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    client = PoliteClient(
        transport=httpx.MockTransport(record),
        sleep=t.sleep,
        clock=t.clock,
        **kwargs,  # type: ignore[arg-type]
    )
    return client, t, seen


def site(robots: str | None = "", pages: dict[str, httpx.Response] | None = None) -> Handler:
    pages = pages or {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404) if robots is None else httpx.Response(200, text=robots)
        return pages.get(request.url.path, httpx.Response(200, text="ok"))

    return handler


def test_identifies_the_project_and_a_contact() -> None:
    client, _, seen = make_client(site())
    client.get("https://example.test/a")
    assert seen[-1].headers["user-agent"] == USER_AGENT
    assert "urban-development-monitor@pm.me" in USER_AGENT
    assert "+https://" in USER_AGENT


def test_refuses_paths_disallowed_by_robots_txt() -> None:
    client, _, seen = make_client(site("User-agent: *\nDisallow: /private/\n"))
    with pytest.raises(Blocked, match=r"robots\.txt"):
        client.get("https://example.test/private/doc.pdf")
    assert all(r.url.path == "/robots.txt" for r in seen)
    assert client.get("https://example.test/public").status == 200


def test_missing_robots_txt_allows_everything() -> None:
    client, _, _ = make_client(site(robots=None))
    assert client.allowed("https://example.test/anything")


def test_html_404_page_served_as_robots_txt_allows_everything() -> None:
    client, _, _ = make_client(site("<!DOCTYPE html><html><body>Eroare 404</body></html>"))
    assert client.allowed("https://example.test/anything")


def test_unreachable_robots_txt_blocks_the_host() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503) if request.url.path == "/robots.txt" else httpx.Response(200)

    client, _, _ = make_client(handler)
    with pytest.raises(Blocked, match="unreachable"):
        client.get("https://example.test/a")


def test_robots_txt_is_fetched_once_per_host() -> None:
    client, _, seen = make_client(site())
    client.get("https://example.test/a")
    client.get("https://example.test/b")
    assert [r.url.path for r in seen].count("/robots.txt") == 1


def test_blocked_hosts_are_refused_without_any_request() -> None:
    client, _, seen = make_client(site(), blocked_hosts=["Extranet.example.test"])
    with pytest.raises(Blocked, match="off-limits"):
        client.get("https://extranet.example.test/permits")
    assert seen == []


def test_redirect_to_a_blocked_host_is_refused() -> None:
    pages = {"/go": httpx.Response(302, headers={"location": "https://extranet.example.test/x"})}
    client, _, _ = make_client(site(pages=pages), blocked_hosts=["extranet.example.test"])
    with pytest.raises(Blocked):
        client.get("https://example.test/go")


def test_follows_redirects_within_allowed_paths() -> None:
    pages = {
        "/old": httpx.Response(301, headers={"location": "/new"}),
        "/new": httpx.Response(200, text="moved"),
    }
    client, _, _ = make_client(site(pages=pages))
    resp = client.get("https://example.test/old")
    assert resp.status == 200
    assert resp.url == "https://example.test/new"


def test_waits_between_requests_to_the_same_host() -> None:
    client, t, _ = make_client(site(), min_interval=2.5)
    client.get("https://example.test/a")
    client.get("https://example.test/b")
    assert t.sleeps
    assert sum(t.sleeps) >= 2.5 * 2  # robots -> a -> b


def test_does_not_wait_between_different_hosts() -> None:
    client, t, _ = make_client(site(), min_interval=2.5)
    client.get("https://one.test/a")
    t.sleeps.clear()
    client.get("https://two.test/a")  # robots for two.test, then the page
    assert sum(t.sleeps) == pytest.approx(2.5)


def test_retries_server_errors_with_backoff_and_retry_after() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "30"})
        if calls["n"] == 2:
            return httpx.Response(503)
        return httpx.Response(200, text="finally")

    client, t, _ = make_client(handler, min_interval=0)
    assert client.get("https://example.test/a").content == b"finally"
    assert 30 in t.sleeps  # Retry-After honoured
    assert 4.0 in t.sleeps  # second back-off: 2 * 2**1


def test_gives_up_after_max_retries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        raise httpx.ConnectError("boom")

    client, _, _ = make_client(handler, min_interval=0, max_retries=2)
    with pytest.raises(FetchFailed, match="ConnectError"):
        client.get("https://example.test/a")


def test_stops_after_too_many_consecutive_errors() -> None:
    pages = {"/bad": httpx.Response(403)}
    client, _, _ = make_client(site(pages=pages), min_interval=0, max_consecutive_errors=3)
    for _ in range(3):
        assert client.get("https://example.test/bad").status == 403
    with pytest.raises(TooManyErrors):
        client.get("https://example.test/good")


def test_success_resets_the_error_count() -> None:
    pages = {"/bad": httpx.Response(403)}
    client, _, _ = make_client(site(pages=pages), min_interval=0, max_consecutive_errors=2)
    client.get("https://example.test/bad")
    client.get("https://example.test/good")
    client.get("https://example.test/bad")
    client.get("https://example.test/good")  # would raise if the count hadn't reset


def test_conditional_get_sends_validators_and_reports_not_modified() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, headers={"etag": '"v1"'}, text="body")

    client, _, _ = make_client(handler, min_interval=0)
    first = client.get("https://example.test/a")
    assert first.etag == '"v1"'
    again = client.get(
        "https://example.test/a", etag=first.etag, last_modified="Wed, 01 Jan 2025 00:00:00 GMT"
    )
    assert again.not_modified


def test_aborts_oversized_downloads() -> None:
    pages = {"/big.pdf": httpx.Response(200, content=b"x" * 2048)}
    client, _, _ = make_client(site(pages=pages), min_interval=0, max_bytes=1024)
    with pytest.raises(TooLarge):
        client.get("https://example.test/big.pdf")


def test_head_reports_size_without_downloading() -> None:
    pages = {"/doc.pdf": httpx.Response(200, headers={"content-length": "123456"})}
    client, _, seen = make_client(site(pages=pages), min_interval=0)
    resp = client.head("https://example.test/doc.pdf")
    assert seen[-1].method == "HEAD"
    assert resp.content_length == 123456
    assert resp.content == b""

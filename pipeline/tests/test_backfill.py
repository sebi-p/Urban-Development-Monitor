"""M5.1: the notices back-fill walks article numbers down to a date, on saved pages."""

import json
from datetime import date
from typing import Any

import httpx
import psycopg
import pytest

from mdu import backfill
from mdu.adapters.brasov import notices
from mdu.adapters.brasov.backfill import newest_article, read_article
from mdu.adapters.brasov.ingest import elsewhere, is_planning_notice
from mdu.adapters.brasov.registry import ADAPTERS
from mdu.core.http import PoliteClient
from mdu.core.streets import StreetIndex
from mdu.fixtures import fixture_bytes
from mdu.ingest import IngestStats

NEWEST = 37909  # the highest number on the saved listing


def raw(name: str) -> bytes:
    return fixture_bytes("brasov", name)


def site(articles: dict[int, str]) -> tuple[PoliteClient, list[str]]:
    """The listing plus articles by number; every other number is the 404 template's twin."""
    pages = {notices.article_url(n): raw(f"notices/{name}") for n, name in articles.items()}
    pages[notices.LISTING_URL] = raw("notices/listing")
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        url = str(request.url)
        seen.append(url)
        if url == notices.LISTING_URL:
            return httpx.Response(200, content=pages[url], headers={"content-type": "text/html"})
        body = pages.get(url) or raw("notices/article-missing")
        return httpx.Response(404, content=body, headers={"content-type": "text/html"})

    client = PoliteClient(
        transport=httpx.MockTransport(handler), sleep=lambda _: None, min_interval=0
    )
    return client, seen


def test_titles_decide_what_is_a_planning_notice_here() -> None:
    assert is_planning_notice("ANUNŢ – INFORMARE ŞI CONSULTARE PUBLIC INTERESAT – PUZ str. Lungă")
    assert is_planning_notice("Anunț informare și consultare public interesat privind PUD")
    assert not is_planning_notice("Anunț – Decizia etapei de încadrare pentru PUZ „Centrul Civic”")
    assert not is_planning_notice("ANUNŢ – INFORMARE ŞI CONSULTARE ETAPA 2")  # no PUZ/PUD
    assert elsewhere("PUZ – zonă de mică industrie, intravilan municipiul Săcele")
    assert elsewhere("PUD casă, comuna Hărman")
    assert not elsewhere("PUZ zonă comercială, municipiul Brașov")
    assert not elsewhere("PUZ în municipiu, str. Lungă")
    url = notices.article_url(37827)
    assert url.endswith("/Mzc4Mjc")
    assert notices.decode_article_id("Mzc4Mjc") == 37827


def test_articles_by_number() -> None:
    client, _ = site({10: "puz-information-notice", 9: "article-news-2021",
                      8: "article-other-town-2021"})  # fmt: skip
    streets, stats = StreetIndex({}), IngestStats()
    assert newest_article(client) == NEWEST
    notice = read_article(client, streets, stats, 10)
    assert notice.found
    assert notice.record is not None
    assert notice.record.private_key == "notice:10"
    assert notice.record.kind == "puz"
    assert len(notice.items) == 2  # its attachments, queued with the article number
    assert {i.hints["article_id"] for i in notice.items} == {10}
    news = read_article(client, streets, stats, 9)
    assert (news.found, news.published, news.record) == (True, date(2021, 3, 1), None)
    other_town = read_article(client, streets, stats, 8)
    assert other_town.found
    assert other_town.record is None
    assert stats.skipped_other["a plan in another town"] == 1
    assert read_article(client, streets, stats, 7).found is False


def _jid(pg: psycopg.Connection[Any]) -> None:
    pg.execute("update jurisdiction set slug = 'brasov' where slug = 'testcity'")


def test_walks_down_to_the_date_in_checkpoints_and_resumes(
    pg: psycopg.Connection[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    _jid(pg)
    monkeypatch.setattr(backfill, "CHECKPOINT", 3)
    monkeypatch.setattr(backfill, "OLDER_IN_A_ROW", 2)
    articles = {
        NEWEST - 2: "puz-information-notice",  # 2026
        NEWEST - 6: "article-news-2021",
        NEWEST - 8: "article-other-town-2021",
    }
    client, seen = site(articles)
    adapter = ADAPTERS["brasov.notices"]
    ticks = iter(range(100))

    def clock() -> float:  # one "second" per number walked
        return float(next(ticks))

    common: dict[str, Any] = {"city": "brasov", "since": date(2022, 1, 1), "upload": None}
    first = backfill.run(pg, client, StreetIndex({}), adapter, seconds=4, clock=clock, **common)
    assert first.walked == 3  # out of time (reading the deadline takes the first tick)
    assert (first.projects, first.documents) == (1, 2)
    assert first.cursor.next_id == NEWEST - 3
    assert not first.cursor.done
    projects = pg.execute("select count(*) from project").fetchone()
    assert projects == (1,)
    queued = pg.execute("""select count(*) from "fetch" where status = 'pending'""").fetchone()
    assert queued == (2,)

    second = backfill.run(pg, client, StreetIndex({}), adapter, seconds=50, clock=clock, **common)
    assert second.cursor.done  # two articles from 2021 in a row: past the date
    assert second.cursor.next_id == NEWEST - 9
    assert dict(second.cursor.years["2026"]) == {"articles": 1, "projects": 1}
    assert dict(second.cursor.years["2021"]) == {"articles": 2}

    before = len(seen)
    again = backfill.run(pg, client, StreetIndex({}), adapter, seconds=50, clock=clock, **common)
    assert again.walked == 0
    assert len(seen) == before
    lines = backfill.status(pg, "brasov", [adapter])
    assert lines[0].startswith("brasov.notices: back to 2022-01-01, done")
    assert "  2026: 1 articles, 1 PUZ/PUD notices" in lines

    # An earlier date resumes the walk where it stopped.
    common["since"] = date(2020, 1, 1)
    more = backfill.run(pg, client, StreetIndex({}), adapter, seconds=3, clock=clock, **common)
    assert more.walked == 2
    assert more.cursor.next_id == NEWEST - 11


def test_each_night_leaves_one_row_for_the_watchdog(pg: psycopg.Connection[Any]) -> None:
    _jid(pg)
    backfill.record_night(pg, "brasov", done=False, walked=12)
    backfill.record_night(pg, "brasov", done=False, walked=0, error="started after 06:00")
    rows = pg.execute(
        """select status::text, stats->>'done', stats->>'walked', error from pipeline_run
           where stage = 'backfill_night' order by status desc"""
    ).fetchall()
    assert rows == [
        ("succeeded", "false", "12", None),
        ("failed", "false", "0", "started after 06:00"),
    ]
    # The walk's checkpoint is a separate stage: a night row never resets the cursor.
    assert backfill.load_cursor(pg, "brasov", "brasov.notices") is None


def test_each_checkpoint_commits_on_a_connection_outside_autocommit(
    pg: psycopg.Connection[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Production's shape: a bare read once left a transaction open all night, so the checkpoints
    were savepoints in it, committed only when the connection closed."""
    _jid(pg)
    monkeypatch.setattr(backfill, "CHECKPOINT", 2)
    client, _ = site({NEWEST - 1: "puz-information-notice"})
    ticks = iter(range(100))
    pg.autocommit = False
    try:
        r = backfill.run(
            pg, client, StreetIndex({}), ADAPTERS["brasov.notices"], city="brasov",
            since=date(2020, 1, 1), seconds=5, upload=None, clock=lambda: float(next(ticks)),
        )  # fmt: skip
        assert r.walked == 4
        assert pg.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
    finally:
        pg.rollback()
        pg.autocommit = True
    stamps = pg.execute(
        "select count(distinct started_at), count(*) from pipeline_run where stage = 'backfill'"
    ).fetchone()
    assert stamps == (3, 3)  # each checkpoint committed (two, then the last), with its own time


def test_resumes_from_the_furthest_checkpoint_when_times_tie(pg: psycopg.Connection[Any]) -> None:
    _jid(pg)
    row = pg.execute("select id from jurisdiction where slug = 'brasov'").fetchone()
    assert row
    jid = row[0]
    for walked, next_id in ((200, 800), (100, 900), (300, 700)):
        stats = {"next_id": next_id, "since": "2020-01-01", "done": False, "walked": walked}
        pg.execute(
            """insert into pipeline_run (jurisdiction_id, adapter, stage, status, started_at,
                   stats)
               values (%s, 'brasov.notices', 'backfill', 'succeeded',
                       '2026-11-26 20:50:56+00', %s)""",
            (jid, json.dumps(stats)),
        )
    cursor = backfill.load_cursor(pg, "brasov", "brasov.notices")
    assert cursor is not None
    assert (cursor.walked, cursor.next_id) == (300, 700)

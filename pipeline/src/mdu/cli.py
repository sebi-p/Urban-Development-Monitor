"""`mdu` command-line entry point."""

import argparse
import os
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from mdu import __version__
from mdu.core.env import load_env
from mdu.core.http import HttpError, PoliteClient
from mdu.core.jurisdiction import load_jurisdiction

if TYPE_CHECKING:
    from mdu.core.adapter import Adapter
    from mdu.core.streets import StreetIndex

STREETS_MAX_AGE_DAYS = 30
EXIT_NOT_IMPLEMENTED = 2
EXIT_FAILED = 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mdu", description="Monitor Dezvoltare Urbană pipeline")
    parser.add_argument("--version", action="version", version=f"mdu {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="ingest an adapter's listing into Postgres")
    ingest.add_argument(
        "--adapter", required=True, help='adapter key, e.g. "brasov.council_debates"'
    )
    ingest.add_argument("--dry-run", action="store_true", help="fetch and parse; write nothing")

    run = sub.add_parser("run", help="run a pipeline stage against Postgres")
    run.add_argument("--stage", required=True, choices=["discover", "fetch", "extract", "classify"])
    run.add_argument("--city", required=True)
    run.add_argument("--adapter", help='e.g. "brasov.council_debates" (required for discover)')
    run.add_argument("--limit", type=int, default=100, help="fetch/extract: max items this run")
    run.add_argument("--max-mb", type=int, default=30, help="fetch: skip larger files")
    run.add_argument("--all", action="store_true", help="discover: not only PUZ/PUD (back-fill)")
    run.add_argument("--no-llm", action="store_true", help="classify: rules only")
    run.add_argument(
        "--night-only", action="store_true", help="refuse to run outside 22:00–06:00 Bucharest"
    )

    daily = sub.add_parser("daily", help="scheduled run: every daily adapter, fetch, extract")
    daily.add_argument("--city", required=True)
    daily.add_argument("--fetch-limit", type=int, default=300, help="max documents to fetch")
    daily.add_argument("--max-mb", type=int, default=30, help="skip larger files")

    streets = sub.add_parser("streets", help="build and cache a city's street index (OSM tiles)")
    streets.add_argument("--city", required=True)

    inv = sub.add_parser("inventory", help="discover-only survey of a city's sources (M0.2)")
    inv.add_argument("--city", required=True)
    inv.add_argument("--no-upload", action="store_true", help="don't upload the private CSV to R2")

    fetch = sub.add_parser("fetch", help="politely download URLs to a local folder (exploration)")
    fetch.add_argument("--city", required=True, help="jurisdiction slug (for blocked hosts)")
    fetch.add_argument("--out", type=Path, required=True, help="folder to write files into")
    fetch.add_argument("urls", nargs="+")

    fx = sub.add_parser("fixtures", help="manage test fixtures (raw files live in private R2)")
    fx_sub = fx.add_subparsers(dest="fixtures_command", required=True)
    capture = fx_sub.add_parser("capture", help="download a URL as a named fixture")
    capture.add_argument("--city", required=True)
    capture.add_argument("--source", required=True, help='source key, e.g. "council_debates"')
    capture.add_argument("--name", required=True, help="fixture name within the source")
    capture.add_argument("--note", default="", help="what the fixture shows (no personal data)")
    capture.add_argument("--replace", action="store_true")
    capture.add_argument(
        "--allow-status",
        type=int,
        action="append",
        default=[],
        help="accept this non-200 status (repeatable), e.g. a page that serves content with a 404",
    )
    capture.add_argument("url")
    for name, help_text in (
        ("push", "upload local fixtures missing from R2"),
        ("pull", "download fixtures from R2 into the local cache"),
        ("verify", "check the local cache against the manifest"),
    ):
        p = fx_sub.add_parser(name, help=help_text)
        p.add_argument("--city", required=True)
    return parser


def _registry(city: str) -> tuple[dict[str, "Adapter"], list[str]]:
    import importlib  # noqa: PLC0415

    module = importlib.import_module(f"mdu.adapters.{city}.registry")
    return module.ADAPTERS, module.DAILY


def _database_url() -> str | None:
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
    return url


def _llm(disabled: bool = False) -> tuple[object | None, float]:
    """The classifier's LLM fallback when ANTHROPIC_API_KEY is set (ADR 0008), and the monthly
    budget in USD (MDU_LLM_MONTHLY_USD, default 2)."""
    budget = float(os.environ.get("MDU_LLM_MONTHLY_USD") or 2)
    if disabled or not os.environ.get("ANTHROPIC_API_KEY"):
        return None, budget
    from mdu.core.llm import ClaudeClassifier  # noqa: PLC0415

    return ClaudeClassifier(), budget


def _client(city: str) -> PoliteClient:
    return PoliteClient(blocked_hosts=load_jurisdiction(city).blocked_hosts)


def _fetch(args: argparse.Namespace) -> int:
    from mdu.fixtures import extension_for  # noqa: PLC0415

    args.out.mkdir(parents=True, exist_ok=True)
    failed = 0
    with _client(args.city) as client:
        for i, url in enumerate(args.urls, start=1):
            try:
                resp = client.get(url)
            except HttpError as exc:
                print(f"FAIL {url}: {exc}", file=sys.stderr)
                failed += 1
                continue
            path = args.out / f"{i:03d}.{extension_for(resp.content_type, resp.url)}"
            path.write_bytes(resp.content)
            print(f"{resp.status} {len(resp.content):>9} {resp.content_type} {resp.url} -> {path}")
    return EXIT_FAILED if failed else 0


def _fixtures(args: argparse.Namespace) -> int:
    from mdu.core.storage import ObjectStore  # noqa: PLC0415
    from mdu.fixtures import FixtureSet  # noqa: PLC0415

    fs = FixtureSet(args.city)
    cmd = args.fixtures_command
    if cmd == "capture":
        with _client(args.city) as client:
            resp = client.get(args.url)
        if resp.status != 200 and resp.status not in args.allow_status:  # noqa: PLR2004
            print(f"refusing to capture HTTP {resp.status} (see --allow-status)", file=sys.stderr)
            return EXIT_FAILED
        f = fs.add(
            source=args.source, name=args.name, resp=resp, note=args.note, replace=args.replace
        )
        print(f"{f.id}: {f.status} {f.content_type} {f.size} bytes -> {fs.local_path(f)}")
        return 0
    if cmd == "verify":
        problems = fs.verify()
        for p in problems:
            print(p, file=sys.stderr)
        print(f"{len(fs.load())} fixtures, {len(problems)} problems")
        return EXIT_FAILED if problems else 0
    store = ObjectStore.from_env()
    if cmd == "push":
        print(f"uploaded {fs.push(store)} fixtures to R2")
    else:
        print(f"downloaded {fs.pull(store)} fixtures from R2")
    return 0


def _inventory(args: argparse.Namespace) -> int:
    from mdu import inventory  # noqa: PLC0415
    from mdu.core.storage import ObjectStore, StorageNotConfigured  # noqa: PLC0415

    upload: Callable[[str, bytes], None] | None = None
    if not args.no_upload:
        try:
            store = ObjectStore.from_env()
        except StorageNotConfigured as exc:
            print(f"R2 not configured ({exc}); pass --no-upload to skip", file=sys.stderr)
            return EXIT_FAILED

        def put_csv(key: str, data: bytes) -> None:
            store.put(key, data, "text/csv")

        upload = put_csv

    with _client(args.city) as client:
        survey = inventory.run(args.city, client, log=lambda m: print(m, flush=True))
    private, summary = inventory.write_outputs(survey, upload)
    print(
        f"private rows: {private} ({len(survey.rows)} rows{', uploaded to R2' if upload else ''})"
    )
    print(f"summary (commit this): {summary}")
    return 0


def _street_index(city: str, client: PoliteClient, *, refresh: bool = False) -> "StreetIndex":
    """Local cache, then R2, then the OpenFreeMap street tiles (which refresh both caches).
    Copies older than STREETS_MAX_AGE_DAYS are rebuilt (about 60 tile requests)."""
    import time  # noqa: PLC0415

    from mdu.core.env import REPO_ROOT  # noqa: PLC0415
    from mdu.core.storage import ObjectStore, StorageNotConfigured  # noqa: PLC0415
    from mdu.core.streets import StreetIndex, fetch_street_index  # noqa: PLC0415

    cache = REPO_ROOT / "pipeline" / ".cache" / f"streets-{city}.json"
    key = f"cache/streets/{city}.json"
    try:
        store: ObjectStore | None = ObjectStore.from_env()
    except StorageNotConfigured:
        store = None
    if not refresh:
        if cache.is_file() and time.time() - cache.stat().st_mtime < STREETS_MAX_AGE_DAYS * 86400:
            return StreetIndex.from_json(cache.read_text(encoding="utf-8"))
        age = store.age_days(key) if store else None
        if store and age is not None and age < STREETS_MAX_AGE_DAYS:
            text = store.get(key).decode("utf-8")
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(text, encoding="utf-8")
            return StreetIndex.from_json(text)
    index = fetch_street_index(client, load_jurisdiction(city).bbox, log=print)  # bbox centre
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(index.to_json(), encoding="utf-8")
    if store:
        store.put(key, index.to_json().encode("utf-8"), "application/json")
    return index


def _streets(args: argparse.Namespace) -> int:
    with _client(args.city) as c:
        index = _street_index(args.city, c, refresh=True)
    print(f"{len(index)} named streets cached for {args.city}")
    return 0


def _ingest(args: argparse.Namespace) -> int:
    import psycopg  # noqa: PLC0415

    from mdu.core.storage import ObjectStore  # noqa: PLC0415
    from mdu.ingest import IngestStats, write_records  # noqa: PLC0415

    city = args.adapter.split(".", 1)[0]
    adapters, _ = _registry(city)
    adapter = adapters.get(args.adapter)
    if adapter is None or adapter.projects is None:
        known = ", ".join(k for k, a in adapters.items() if a.projects)
        print(f"{args.adapter} doesn't list projects; these do: {known}", file=sys.stderr)
        return EXIT_FAILED
    base_url, build = adapter.base_url, adapter.projects
    stats = IngestStats()
    with _client(city) as client:
        streets = _street_index(city, client)
        records = build(client, streets, stats)
    for r in records:
        where = r.address_text or "(no street match)"
        print(f"{r.event_date} {r.kind:3} {r.status:22} {where[:40]:40} {r.title[:70]}")
    print(
        f"{len(records)} projects, {sum(r.street is not None for r in records)} located; "
        f"skipped: {stats.skipped_personal} for privacy (names or a single home), "
        f"{stats.skipped_other}"
    )
    if args.dry_run:
        return 0
    url = _database_url()
    if not url:
        return EXIT_FAILED
    store = ObjectStore.from_env()
    with psycopg.connect(url) as conn:
        write_records(
            conn,
            city=city,
            adapter=args.adapter,
            base_url=base_url,
            records=records,
            upload=store.put,
            stats=IngestStats(skipped_personal=stats.skipped_personal,
                              skipped_other=stats.skipped_other),
        )  # fmt: skip
    print(f"written to {urlsplit(url).hostname}")
    return 0


def _run(args: argparse.Namespace) -> int:
    import psycopg  # noqa: PLC0415

    from mdu import stages  # noqa: PLC0415
    from mdu.core.storage import ObjectStore  # noqa: PLC0415

    if args.night_only and not stages.is_night():
        print("outside the 22:00–06:00 Bucharest window (PLAN §7); not running", file=sys.stderr)
        return EXIT_FAILED
    url = _database_url()
    if not url:
        return EXIT_FAILED
    if args.stage in ("extract", "classify"):  # R2 only: no requests to the source sites
        with psycopg.connect(url) as conn:
            if args.stage == "extract":
                result = stages.extract(
                    conn, ObjectStore.from_env(), city=args.city, limit=args.limit, log=print
                )
            else:
                llm, budget = _llm(disabled=args.no_llm)
                print(f"classify: LLM {'on' if llm else 'off'}, budget ${budget:.2f}/month")
                result = stages.classify(
                    conn, ObjectStore.from_env(), city=args.city, llm=llm, monthly_usd=budget,
                    limit=args.limit, log=print,
                )  # fmt: skip
        print(f"{args.stage}: {dict(result.counts)}")
        print(f"database: {urlsplit(url).hostname}")
        return 0
    with psycopg.connect(url) as conn, _client(args.city) as client:
        if args.stage == "discover":
            if not args.adapter:
                print("--adapter is required for discover", file=sys.stderr)
                return EXIT_FAILED
            adapter = _registry(args.city)[0].get(args.adapter)
            if adapter is None or adapter.discover is None:
                print(f"{args.adapter} has no discover step", file=sys.stderr)
                return EXIT_FAILED
            items = adapter.mark_never_mirror(adapter.discover(client, include_all=args.all))
            result = stages.discover(
                conn, city=args.city, adapter=args.adapter, base_url=adapter.base_url, items=items
            )
        else:
            result = stages.fetch(
                conn,
                client,
                city=args.city,
                adapter=args.adapter,
                limit=args.limit,
                upload=ObjectStore.from_env().put,
                max_bytes=args.max_mb * 1024 * 1024,
                log=print,
            )
    print(f"{args.stage}: {dict(result.counts)}; {client.requests_sent} requests")
    print(f"database: {urlsplit(url).hostname}")
    return 0


def _daily(args: argparse.Namespace) -> int:
    import psycopg  # noqa: PLC0415

    from mdu import daily  # noqa: PLC0415
    from mdu.core.storage import ObjectStore  # noqa: PLC0415

    url = _database_url()
    if not url:
        return EXIT_FAILED
    adapters, order = _registry(args.city)
    store = ObjectStore.from_env()
    with psycopg.connect(url) as conn, _client(args.city) as client:
        streets = _street_index(args.city, client)
        llm, budget = _llm()
        result = daily.run(
            conn,
            client,
            store,
            streets,
            [adapters[k] for k in order],
            city=args.city,
            llm=llm,
            llm_monthly_usd=budget,
            fetch_limit=args.fetch_limit,
            max_bytes=args.max_mb * 1024 * 1024,
            log=lambda m: print(m, flush=True),
        )
        requests = client.requests_sent
    print(f"daily: {len(result.steps)} steps, {len(result.failed)} failed; {requests} requests")
    print(f"database: {urlsplit(url).hostname}")
    return 0 if result.ok else EXIT_FAILED


def main(argv: Sequence[str] | None = None) -> int:
    load_env()
    args = build_parser().parse_args(argv)
    commands: dict[str, Callable[[argparse.Namespace], int]] = {
        "daily": _daily,
        "fetch": _fetch,
        "fixtures": _fixtures,
        "inventory": _inventory,
        "streets": _streets,
        "run": _run,
        "ingest": _ingest,
    }
    handler = commands.get(args.command)
    if handler is None:
        print(f"mdu {args.command}: not implemented yet", file=sys.stderr)
        return EXIT_NOT_IMPLEMENTED
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())

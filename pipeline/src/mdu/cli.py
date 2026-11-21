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
    from mdu.core.streets import StreetIndex

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
    run.add_argument("--stage", required=True, choices=["discover", "fetch", "extract"])
    run.add_argument("--city", required=True)
    run.add_argument("--adapter", help='e.g. "brasov.council_debates" (required for discover)')
    run.add_argument("--limit", type=int, default=100, help="fetch/extract: max items this run")
    run.add_argument("--max-mb", type=int, default=30, help="fetch: skip larger files")
    run.add_argument("--all", action="store_true", help="discover: not only PUZ/PUD (back-fill)")
    run.add_argument(
        "--night-only", action="store_true", help="refuse to run outside 22:00–06:00 Bucharest"
    )

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
    """Local cache, then R2, then the OpenFreeMap street tiles (which refresh both caches)."""
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
        if cache.is_file():
            return StreetIndex.from_json(cache.read_text(encoding="utf-8"))
        if store and store.exists(key):
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
    import importlib  # noqa: PLC0415

    import psycopg  # noqa: PLC0415

    from mdu.core.storage import ObjectStore  # noqa: PLC0415
    from mdu.ingest import IngestStats, write_records  # noqa: PLC0415

    city = args.adapter.split(".", 1)[0]
    adapters = importlib.import_module(f"mdu.adapters.{city}.ingest").ADAPTERS
    if args.adapter not in adapters:
        print(f"unknown adapter {args.adapter}; known: {', '.join(adapters)}", file=sys.stderr)
        return EXIT_FAILED
    base_url, build = adapters[args.adapter]
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
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
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
    import importlib  # noqa: PLC0415

    import psycopg  # noqa: PLC0415

    from mdu import stages  # noqa: PLC0415
    from mdu.core.storage import ObjectStore  # noqa: PLC0415

    if args.night_only and not stages.is_night():
        print("outside the 22:00–06:00 Bucharest window (PLAN §7); not running", file=sys.stderr)
        return EXIT_FAILED
    url = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return EXIT_FAILED
    if args.stage == "extract":  # reads R2 only: no HTTP client, no requests to the sites
        with psycopg.connect(url) as conn:
            result = stages.extract(
                conn, ObjectStore.from_env(), city=args.city, limit=args.limit, log=print
            )
        print(f"extract: {dict(result.counts)}")
        print(f"database: {urlsplit(url).hostname}")
        return 0
    with psycopg.connect(url) as conn, _client(args.city) as client:
        if args.stage == "discover":
            if not args.adapter:
                print("--adapter is required for discover", file=sys.stderr)
                return EXIT_FAILED
            registry = importlib.import_module(f"mdu.adapters.{args.city}.discover").DISCOVER
            base_url, find = registry[args.adapter]
            items = find(client, include_all=args.all)
            result = stages.discover(
                conn, city=args.city, adapter=args.adapter, base_url=base_url, items=items
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


def main(argv: Sequence[str] | None = None) -> int:
    load_env()
    args = build_parser().parse_args(argv)
    commands: dict[str, Callable[[argparse.Namespace], int]] = {
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

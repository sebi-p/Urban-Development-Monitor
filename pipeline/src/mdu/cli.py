"""`mdu` command-line entry point."""

import argparse
import os
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from mdu import __version__
from mdu.core.env import load_env
from mdu.core.http import HttpError, PoliteClient
from mdu.core.jurisdiction import load_jurisdiction

if TYPE_CHECKING:
    from mdu.core.adapter import Adapter
    from mdu.core.streets import AddressIndex, StreetIndex

STREETS_MAX_AGE_DAYS = 30
EXIT_NOT_IMPLEMENTED = 2
EXIT_FAILED = 1


def _add_neighbourhoods(sub: Any) -> None:
    nb = sub.add_parser("neighbourhoods", help="official or hand-drawn neighbourhood boundaries")
    nb_sub = nb.add_subparsers(dest="neighbourhoods_command", required=True)
    nb_import = nb_sub.add_parser(
        "import", help="replace the approximate areas with a GeoJSON file of (Multi)Polygons"
    )
    nb_import.add_argument("--city", required=True)
    nb_import.add_argument("--file", type=Path, required=True, help="GeoJSON, WGS 84")
    nb_import.add_argument("--source", choices=["pug_unit", "manual"], required=True)
    nb_import.add_argument("--name-property", default="name", help="feature property with the name")


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
    run.add_argument(
        "--stage",
        required=True,
        choices=[
            "discover",
            "fetch",
            "extract",
            "classify",
            "fields",
            "link",
            "geocode",
            "consult",
            "summary",
            "neighbourhoods",
        ],
    )
    run.add_argument("--city", required=True)
    run.add_argument("--adapter", help='e.g. "brasov.council_debates" (required for discover)')
    run.add_argument("--limit", type=int, default=100, help="fetch/extract: max items this run")
    run.add_argument("--max-mb", type=int, default=30, help="fetch: skip larger files")
    run.add_argument("--all", action="store_true", help="discover: not only PUZ/PUD (back-fill)")
    run.add_argument("--no-llm", action="store_true", help="classify: rules only")
    run.add_argument(
        "--refresh", action="store_true", help="neighbourhoods: redraw the approximate OSM areas"
    )
    run.add_argument(
        "--night-only", action="store_true", help="refuse to run outside 22:00–06:00 Bucharest"
    )

    daily = sub.add_parser("daily", help="scheduled run: every daily adapter, fetch, extract")
    daily.add_argument("--city", required=True)
    daily.add_argument("--fetch-limit", type=int, default=300, help="max documents to fetch")
    daily.add_argument("--max-mb", type=int, default=30, help="skip larger files")

    ev = sub.add_parser("eval", help="score field extraction on the golden set (calls the model)")
    ev.add_argument("what", choices=["fields", "consult"])
    ev.add_argument("--city", default="brasov")
    ev.add_argument("--model", default=None, help="default: the configured fields model")
    ev.add_argument("--record", action="store_true", help="save answers as private fixtures")

    _add_neighbourhoods(sub)

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


def _budget() -> float:
    return float(os.environ.get("MDU_LLM_MONTHLY_USD") or 5)


def _task(kind: str, disabled: bool = False) -> object | None:
    """The consult reader or summary writer (Claude Sonnet, M4.2) when ANTHROPIC_API_KEY is set."""
    if disabled or not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    from mdu.core import llm  # noqa: PLC0415

    return llm.consult_reader() if kind == "consult" else llm.summary_writer()


def _llm(disabled: bool = False) -> tuple[object | None, float]:
    """The classifier's LLM fallback when ANTHROPIC_API_KEY is set (ADR 0008), and the monthly
    budget in USD (MDU_LLM_MONTHLY_USD, default 5)."""
    budget = _budget()
    if disabled or not os.environ.get("ANTHROPIC_API_KEY"):
        return None, budget
    from mdu.core.llm import ClaudeClassifier  # noqa: PLC0415

    return ClaudeClassifier(), budget


def _field_extractor(disabled: bool = False) -> tuple[object | None, float]:
    """The field extractor (Claude Sonnet, ADR 0009) when ANTHROPIC_API_KEY is set."""
    budget = _budget()
    if disabled or not os.environ.get("ANTHROPIC_API_KEY"):
        return None, budget
    from mdu.core.llm import ClaudeFieldExtractor  # noqa: PLC0415

    return ClaudeFieldExtractor(), budget


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


def _indexes(
    city: str, client: PoliteClient, *, refresh: bool = False
) -> tuple["StreetIndex", "AddressIndex"]:
    """Street and house-number indexes: local cache, then R2, then the OpenFreeMap tiles (one
    pass, about 60 requests, which refreshes both caches). Copies older than
    STREETS_MAX_AGE_DAYS are rebuilt."""
    import time  # noqa: PLC0415

    from mdu.core.env import REPO_ROOT  # noqa: PLC0415
    from mdu.core.storage import ObjectStore, StorageNotConfigured  # noqa: PLC0415
    from mdu.core.streets import AddressIndex, StreetIndex, fetch_indexes  # noqa: PLC0415

    names = {"streets": f"streets-{city}.json", "addresses": f"addresses-{city}.json"}
    local = {k: REPO_ROOT / "pipeline" / ".cache" / v for k, v in names.items()}
    remote = {"streets": f"cache/streets/{city}.json", "addresses": f"cache/addresses/{city}.json"}
    try:
        store: ObjectStore | None = ObjectStore.from_env()
    except StorageNotConfigured:
        store = None

    def cached(kind: str) -> str | None:
        path = local[kind]
        if path.is_file() and time.time() - path.stat().st_mtime < STREETS_MAX_AGE_DAYS * 86400:
            return path.read_text(encoding="utf-8")
        age = store.age_days(remote[kind]) if store else None
        if store and age is not None and age < STREETS_MAX_AGE_DAYS:
            text = store.get(remote[kind]).decode("utf-8")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            return text
        return None

    if not refresh:
        streets_text, addresses_text = cached("streets"), cached("addresses")
        if streets_text is not None and addresses_text is not None:
            return StreetIndex.from_json(streets_text), AddressIndex.from_json(addresses_text)
    streets, addresses = fetch_indexes(client, load_jurisdiction(city).bbox, log=print)
    for kind, text in (("streets", streets.to_json()), ("addresses", addresses.to_json())):
        local[kind].parent.mkdir(parents=True, exist_ok=True)
        local[kind].write_text(text, encoding="utf-8")
        if store:
            store.put(remote[kind], text.encode("utf-8"), "application/json")
    return streets, addresses


def _street_index(city: str, client: PoliteClient, *, refresh: bool = False) -> "StreetIndex":
    return _indexes(city, client, refresh=refresh)[0]


def _streets(args: argparse.Namespace) -> int:
    with _client(args.city) as c:
        streets, addresses = _indexes(args.city, c, refresh=True)
    print(f"{len(streets)} named streets and {len(addresses)} house numbers cached for {args.city}")
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


def _run_text_stage(args: argparse.Namespace, conn: Any) -> Any:
    """`run --stage consult|summary` (M4.2)."""
    from mdu import consultations, summaries  # noqa: PLC0415
    from mdu.core.storage import ObjectStore  # noqa: PLC0415

    task = _task(args.stage, disabled=args.no_llm)
    print(f"{args.stage}: LLM {'on' if task else 'off'}, budget ${_budget():.2f}/month")
    if args.stage == "consult":
        return consultations.run(
            conn, ObjectStore.from_env(), city=args.city, reader=task, monthly_usd=_budget(),
            log=print,
        )  # fmt: skip
    return summaries.run(
        conn, ObjectStore.from_env(), city=args.city, writer=task, monthly_usd=_budget(),
        log=print,
    )  # fmt: skip


def _run_neighbourhoods(args: argparse.Namespace, url: str) -> int:
    import psycopg  # noqa: PLC0415

    from mdu import neighbourhoods  # noqa: PLC0415

    j = load_jurisdiction(args.city)
    extra = (j.config.get("neighbourhoods") or {}).get("extra") or []
    with psycopg.connect(url) as conn, _client(args.city) as client:
        result = neighbourhoods.run(
            conn, city=args.city, bbox=j.bbox, refresh=args.refresh, log=print,
            seeds=lambda: neighbourhoods.fetch_seeds(client, j.bbox, extra=extra, log=print),
        )  # fmt: skip
    print(f"neighbourhoods: {dict(result.counts)}")
    print(f"database: {urlsplit(url).hostname}")
    return 0


def _run(args: argparse.Namespace) -> int:  # noqa: PLR0911, PLR0912
    import psycopg  # noqa: PLC0415

    from mdu import stages  # noqa: PLC0415
    from mdu.core.storage import ObjectStore  # noqa: PLC0415

    if args.night_only and not stages.is_night():
        print("outside the 22:00–06:00 Bucharest window (PLAN §7); not running", file=sys.stderr)
        return EXIT_FAILED
    url = _database_url()
    if not url:
        return EXIT_FAILED
    offline = ("extract", "classify", "fields", "link", "geocode", "consult", "summary")
    if args.stage in offline:  # no site requests
        with psycopg.connect(url) as conn:
            if args.stage in ("consult", "summary"):
                result = _run_text_stage(args, conn)
            elif args.stage == "geocode":
                from mdu import geocode  # noqa: PLC0415

                with _client(args.city) as client:  # map tiles only, cached in R2
                    streets, addresses = _indexes(args.city, client)
                result = geocode.run(
                    conn, ObjectStore.from_env(), city=args.city,
                    bbox=load_jurisdiction(args.city).bbox, streets=streets, addresses=addresses,
                )  # fmt: skip
            elif args.stage == "link":
                from mdu import linker  # noqa: PLC0415

                extractor, budget = _field_extractor(disabled=args.no_llm)
                with _client(args.city) as client:  # street tiles only, cached in R2
                    streets = _street_index(args.city, client)
                result = linker.run(
                    conn, ObjectStore.from_env(), city=args.city, streets=streets,
                    extractor=extractor, monthly_usd=budget, log=print,
                )  # fmt: skip
            elif args.stage == "fields":
                from mdu.project_fields import extract_fields  # noqa: PLC0415

                extractor, budget = _field_extractor(disabled=args.no_llm)
                print(f"fields: LLM {'on' if extractor else 'off'}, budget ${budget:.2f}/month")
                result = extract_fields(
                    conn, ObjectStore.from_env(), city=args.city, extractor=extractor,
                    monthly_usd=budget, log=print,
                )  # fmt: skip
            elif args.stage == "extract":
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
    if args.stage == "neighbourhoods":  # map tiles only, and only when (re)drawing
        return _run_neighbourhoods(args, url)
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
    from mdu import neighbourhoods  # noqa: PLC0415

    j = load_jurisdiction(args.city)
    extra = (j.config.get("neighbourhoods") or {}).get("extra") or []
    with psycopg.connect(url) as conn, _client(args.city) as client:
        streets, addresses = _indexes(args.city, client)
        llm, budget = _llm()
        extractor, _ = _field_extractor()
        result = daily.run(
            conn,
            client,
            store,
            streets,
            [adapters[k] for k in order],
            city=args.city,
            llm=llm,
            field_extractor=extractor,
            consult_reader=_task("consult"),
            summary_writer=_task("summary"),
            addresses=addresses,
            bbox=j.bbox,
            llm_monthly_usd=budget,
            neighbourhood_seeds=lambda: neighbourhoods.fetch_seeds(
                client, j.bbox, extra=extra, log=print
            ),
            fetch_limit=args.fetch_limit,
            max_bytes=args.max_mb * 1024 * 1024,
            log=lambda m: print(m, flush=True),
        )
        requests = client.requests_sent
    print(f"daily: {len(result.steps)} steps, {len(result.failed)} failed; {requests} requests")
    print(f"database: {urlsplit(url).hostname}")
    return 0 if result.ok else EXIT_FAILED


def _eval(args: argparse.Namespace) -> int:
    from mdu import evals  # noqa: PLC0415
    from mdu.core.llm import FIELDS_MODEL, ClaudeFieldExtractor  # noqa: PLC0415
    from mdu.fixtures import FixtureSet  # noqa: PLC0415

    if args.what == "consult":
        return _eval_consult(args)
    extractor = ClaudeFieldExtractor(model=args.model or FIELDS_MODEL)

    def live(slug: str, pages_text: str) -> tuple[dict[str, object], float]:
        answer = extractor(pages_text)
        print(f"  {slug[:50]}: {answer.input_tokens} in / {answer.output_tokens} out", flush=True)
        return answer.data, answer.cost_usd

    result = evals.run(FixtureSet(args.city), live, model=extractor.model, record=args.record)
    for p in result.projects:
        for name, (want, got) in p.wrong.items():
            why = f" ({p.dropped[name]})" if name in p.dropped else ""
            print(f"WRONG {p.slug[:40]} {name}: expected {want!r}, got {got!r}{why}")
    print(
        f"{extractor.model}: {result.accuracy:.1%} of {result.scored} fields correct; "
        f"${result.cost_usd:.4f}"
        + ("; answers recorded, run `mdu fixtures push`" if args.record else "")
    )
    return 0 if result.accuracy >= evals.REQUIRED_ACCURACY else EXIT_FAILED


def _eval_consult(args: argparse.Namespace) -> int:
    from mdu import evals  # noqa: PLC0415
    from mdu.core.llm import consult_reader  # noqa: PLC0415
    from mdu.fixtures import FixtureSet  # noqa: PLC0415

    reader = consult_reader()
    if args.model:
        reader.model = args.model

    def live(slug: str, text: str) -> tuple[dict[str, object], float]:
        answer = reader(text)
        print(f"  {slug[:50]}: {answer.input_tokens} in / {answer.output_tokens} out", flush=True)
        return answer.data, answer.cost_usd

    fs = FixtureSet(args.city)
    result = evals.consult_run(fs, live, model=reader.model, record=args.record)
    for p in result.projects:
        for name, (want, got) in p.wrong.items():
            why = f" ({p.dropped[name]})" if name in p.dropped else ""
            print(f"WRONG {p.slug[:40]} {name}: expected {want!r}, got {got!r}{why}")
    print(
        f"{reader.model}: {result.accuracy:.1%} of {result.scored} values correct; "
        f"${result.cost_usd:.4f}"
        + ("; answers recorded, run `mdu fixtures push`" if args.record else "")
    )
    return 0 if result.accuracy >= evals.CONSULT_REQUIRED_ACCURACY else EXIT_FAILED


def _neighbourhoods(args: argparse.Namespace) -> int:
    import json  # noqa: PLC0415

    import psycopg  # noqa: PLC0415

    from mdu import neighbourhoods  # noqa: PLC0415

    url = _database_url()
    if not url:
        return EXIT_FAILED
    collection = json.loads(args.file.read_text(encoding="utf-8"))
    with psycopg.connect(url) as conn:
        result = neighbourhoods.import_geojson(
            conn, city=args.city, collection=collection, source=args.source,
            name_property=args.name_property,
        )  # fmt: skip
    print(f"neighbourhoods import: {dict(result.counts)}")
    print(f"database: {urlsplit(url).hostname}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    load_env()
    args = build_parser().parse_args(argv)
    commands: dict[str, Callable[[argparse.Namespace], int]] = {
        "daily": _daily,
        "eval": _eval,
        "fetch": _fetch,
        "fixtures": _fixtures,
        "inventory": _inventory,
        "streets": _streets,
        "neighbourhoods": _neighbourhoods,
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

"""`mdu` command-line entry point."""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from mdu import __version__
from mdu.core.env import load_env
from mdu.core.http import HttpError, PoliteClient
from mdu.core.jurisdiction import load_jurisdiction

EXIT_NOT_IMPLEMENTED = 2
EXIT_FAILED = 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mdu", description="Monitor Dezvoltare Urbană pipeline")
    parser.add_argument("--version", action="version", version=f"mdu {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="run ingestion stages for an adapter")
    ingest.add_argument(
        "--adapter", required=True, help='adapter key, e.g. "brasov.council_debates"'
    )
    ingest.add_argument("--dry-run", action="store_true", help="discover only; write nothing")

    sub.add_parser("inventory", help="discover-only run that counts URLs per source (M0.2)")

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


def main(argv: Sequence[str] | None = None) -> int:
    load_env()
    args = build_parser().parse_args(argv)
    if args.command == "fetch":
        return _fetch(args)
    if args.command == "fixtures":
        return _fixtures(args)
    print(f"mdu {args.command}: not implemented yet", file=sys.stderr)
    return EXIT_NOT_IMPLEMENTED


if __name__ == "__main__":
    raise SystemExit(main())

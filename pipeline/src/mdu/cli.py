"""`mdu` command-line entry point."""

import argparse
import sys
from collections.abc import Sequence

from mdu import __version__

EXIT_NOT_IMPLEMENTED = 2


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
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    print(f"mdu {args.command}: not implemented yet", file=sys.stderr)
    return EXIT_NOT_IMPLEMENTED


if __name__ == "__main__":
    raise SystemExit(main())

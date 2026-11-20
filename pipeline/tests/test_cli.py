import pytest

from mdu import __version__
from mdu.cli import EXIT_NOT_IMPLEMENTED, build_parser, main


def test_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_ingest_parses_adapter_and_dry_run() -> None:
    args = build_parser().parse_args(["ingest", "--adapter", "brasov.council_debates", "--dry-run"])
    assert args.adapter == "brasov.council_debates"
    assert args.dry_run is True


def test_ingest_rejects_an_unknown_city() -> None:
    with pytest.raises(ModuleNotFoundError):
        main(["ingest", "--adapter", "nowhere.debates", "--dry-run"])


def test_exit_code_for_unimplemented_commands_is_distinct() -> None:
    assert EXIT_NOT_IMPLEMENTED == 2

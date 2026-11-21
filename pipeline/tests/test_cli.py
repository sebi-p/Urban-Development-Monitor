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


def test_daily_parses_city_and_limits() -> None:
    args = build_parser().parse_args(["daily", "--city", "brasov", "--fetch-limit", "50"])
    assert (args.city, args.fetch_limit, args.max_mb) == ("brasov", 50, 30)


def test_ingest_refuses_an_adapter_without_projects(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["ingest", "--adapter", "brasov.urbanism_hub", "--dry-run"]) == 1
    assert "doesn't list projects" in capsys.readouterr().err

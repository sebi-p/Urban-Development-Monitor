"""Field-extraction evaluation on the golden set (M3.2; ADR 0009).

`mdu eval fields` calls the model for each golden project, scores the checked values against
`tests/fixtures/<city>/fields_golden.json` and, with `--record`, stores the answers as private
fixtures. CI replays those answers (no API calls) and requires `REQUIRED_ACCURACY`. A change to
page selection or the prompt changes the input hash, and the test then asks for a new recording.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from mdu.core import fields
from mdu.core.streets import fold
from mdu.fixtures import Fixture, FixtureSet

REQUIRED_ACCURACY = 0.90


def _norm_name(text: str) -> str:
    s = fold(text)
    s = re.sub(r"\bs\.?\s?c\.?\b|\bs\.?\s?r\.?\s?l\.?\b|\bs\.?\s?a\.?$", " ", s)
    return re.sub(r"[^\w]+", " ", s).strip()


def matches(name: str, expected: Any, got: Any) -> bool:
    if expected is None or got is None:
        return expected is None and got is None
    if name in fields.NUMBER_FIELDS:
        return abs(float(got) - float(expected)) <= 0.01 * abs(float(expected))
    if name == "height_regime":
        return re.sub(r"\s", "", str(got)).upper() == re.sub(r"\s", "", str(expected)).upper()
    want, have = _norm_name(str(expected)), _norm_name(str(got))
    return bool(want) and (want in have or have in want)


@dataclass
class ProjectScore:
    slug: str
    correct: list[str] = field(default_factory=list)
    wrong: dict[str, tuple[Any, Any]] = field(default_factory=dict)  # field -> (expected, got)
    dropped: dict[str, str] = field(default_factory=dict)


@dataclass
class EvalResult:
    projects: list[ProjectScore] = field(default_factory=list)
    cost_usd: float = 0.0

    @property
    def scored(self) -> int:
        return sum(len(p.correct) + len(p.wrong) for p in self.projects)

    @property
    def accuracy(self) -> float:
        return sum(len(p.correct) for p in self.projects) / max(1, self.scored)


def golden(fs: FixtureSet) -> dict[str, Any]:
    return dict(json.loads((fs.dir / "fields_golden.json").read_text("utf-8"))["projects"])


def selection_for(fs: FixtureSet, project: dict[str, Any]) -> fields.Selection:
    docs = []
    for d in project["documents"]:
        fixture = fs.load()[d["fixture"]]
        data = json.loads(fs.local_path(fixture).read_bytes())
        docs.append(
            fields.SourceDocument(fixture.id, d["doc_type"], [p["text"] for p in data["pages"]])
        )
    return fields.select_pages(docs)


def input_hash(prompt_version: str, model: str, pages_text: str) -> str:
    return hashlib.sha256(f"{prompt_version}\n{model}\n{pages_text}".encode()).hexdigest()


def score(
    slug: str, expected: dict[str, Any], answer: dict[str, Any], sel: fields.Selection
) -> ProjectScore:
    checked = fields.check(answer, sel)
    got = {v.field: v.value for v in checked.kept}
    result = ProjectScore(slug, dropped=checked.dropped)
    for name, want in expected.items():
        if matches(name, want, got.get(name)):
            result.correct.append(name)
        else:
            result.wrong[name] = (want, got.get(name))
    return result


def recording_id(slug: str, model: str) -> str:
    return f"fields-llm/{slug[:40]}-{model}"


def run(
    fs: FixtureSet,
    answer_for: Callable[[str, str], tuple[dict[str, Any], float]],
    *,
    model: str,
    record: bool = False,
) -> EvalResult:
    """`answer_for(slug, pages_text)` returns (answer, cost): a live call or a replay."""
    result = EvalResult()
    fixtures = fs.load()
    for slug, project in sorted(golden(fs).items()):
        sel = selection_for(fs, project)
        text = sel.prompt_text()
        answer, cost = answer_for(slug, text)
        result.cost_usd += cost
        result.projects.append(score(slug, project["expected"], answer, sel))
        if record:
            fid = recording_id(slug, model)
            note = "M3.2 recorded model answer for the golden set (private: quotes name people)"
            _record(
                fs, fixtures, fid=fid, prompt_version=fields.PROMPT_VERSION, model=model,
                text=text, answer=answer, note=note,
            )  # fmt: skip
    if record:
        fs.save(fixtures)
    return result


def _record(  # noqa: PLR0913
    fs: FixtureSet,
    fixtures: dict[str, Fixture],
    *,
    fid: str,
    prompt_version: str,
    model: str,
    text: str,
    answer: dict[str, Any],
    note: str,
) -> None:
    body = json.dumps(
        {"input_hash": input_hash(prompt_version, model, text), "answer": answer},
        ensure_ascii=False,
    ).encode()
    sha = hashlib.sha256(body).hexdigest()
    f = Fixture(
        id=fid,
        source=fid.split("/", maxsplit=1)[0],
        fetched_at=datetime.now(UTC).replace(microsecond=0).isoformat(),
        status=200,
        content_type="application/json",
        size=len(body),
        sha256=sha,
        file=f"{sha}.json",
        note=note,
    )
    fs.files_dir.mkdir(parents=True, exist_ok=True)
    fs.local_path(f).write_bytes(body)
    fixtures[fid] = f


def replay(fs: FixtureSet, model: str) -> Callable[[str, str], tuple[dict[str, Any], float]]:
    def answer_for(slug: str, pages_text: str) -> tuple[dict[str, Any], float]:
        fixture = fs.load()[recording_id(slug, model)]
        data = json.loads(fs.local_path(fixture).read_bytes())
        if data["input_hash"] != input_hash(fields.PROMPT_VERSION, model, pages_text):
            raise AssertionError(
                f"{slug}: the model input changed since the answers were recorded; "
                "run `uv run mdu eval fields --record` and `mdu fixtures push`"
            )
        return data["answer"], 0.0

    return answer_for


# --- Consultation notices (M4.2) -----------------------------------------------------------

CONSULT_REQUIRED_ACCURACY = 0.90


def consult_golden(fs: FixtureSet) -> dict[str, Any]:
    return dict(json.loads((fs.dir / "consult_golden.json").read_text("utf-8"))["notices"])


def consult_pages(fs: FixtureSet, notice: dict[str, Any]) -> list[str]:
    data = json.loads(fs.local_path(fs.load()[notice["fixture"]]).read_bytes())
    return [p["text"] for p in data["pages"]]


def consult_recording_id(slug: str, model: str) -> str:
    return f"consult-llm/{slug}-{model}"


def _consult_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M")
    return value.isoformat() if hasattr(value, "isoformat") else value


def consult_run(
    fs: FixtureSet,
    answer_for: Callable[[str, str], tuple[dict[str, Any], float]],
    *,
    model: str,
    record: bool = False,
) -> EvalResult:
    """Like `run`, for `consult_golden.json`: each expected value must be kept exactly."""
    from mdu.core import consult  # noqa: PLC0415

    result = EvalResult()
    fixtures = fs.load()
    for slug, notice in sorted(consult_golden(fs).items()):
        pages = consult_pages(fs, notice)
        text = consult.prompt_text(pages)
        answer, cost = answer_for(slug, text)
        result.cost_usd += cost
        checked = consult.check(answer, pages)
        got = {k: _consult_value(v.value) for k, v in checked.values.items()}
        score = ProjectScore(slug, dropped=checked.dropped)
        for name, want in notice["expected"].items():
            if got.get(name) == want:
                score.correct.append(name)
            else:
                score.wrong[name] = (want, got.get(name))
        result.projects.append(score)
        if record:
            note = "M4.2 recorded model answer for a notice (private: quotes may name people)"
            fid = consult_recording_id(slug, model)
            _record(
                fs, fixtures, fid=fid, prompt_version=consult.PROMPT_VERSION, model=model,
                text=text, answer=answer, note=note,
            )  # fmt: skip
    if record:
        fs.save(fixtures)
    return result


def consult_replay(
    fs: FixtureSet, model: str
) -> Callable[[str, str], tuple[dict[str, Any], float]]:
    from mdu.core import consult  # noqa: PLC0415

    def answer_for(slug: str, text: str) -> tuple[dict[str, Any], float]:
        data = json.loads(fs.local_path(fs.load()[consult_recording_id(slug, model)]).read_bytes())
        if data["input_hash"] != input_hash(consult.PROMPT_VERSION, model, text):
            raise AssertionError(
                f"{slug}: the model input changed since the answers were recorded; "
                "run `uv run mdu eval consult --record` and `mdu fixtures push`"
            )
        return data["answer"], 0.0

    return answer_for

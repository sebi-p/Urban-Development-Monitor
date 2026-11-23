"""M4.2: consultation dates and how to comment, read from the city's notices. Values are kept only
when quoted from the page; the golden set replays recorded answers (CI never calls the API)."""

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any

import psycopg

from mdu import consultations, evals
from mdu.core import consult
from mdu.core.documents import store_raw_document
from mdu.core.llm import FIELDS_MODEL, JsonAnswer
from mdu.fixtures import FixtureSet

PAGE = (
    "ANUNȚ. Propuneri, sugestii, opinii se pot depune în perioada: 23.09.2026 - 05.10.2026, "
    "ora 16.00, prin e-mail: infopublice@brasovcity.ro sau la sediul instituției, B-dul. Eroilor "
    "nr. 8. Dezbaterea publică are loc în data de 1 octombrie 2026, ora 15.00, la sala mare. "
    "Persoană de contact: Ion Pop, ion.pop@gmail.com"
)


def item(value: Any, quote: str, page: int = 1, **extra: Any) -> dict[str, Any]:
    return {"value": value, "page": page, "quote": quote, **extra}


def test_dates_in_romanian_formats() -> None:
    assert dates_of("în perioada 30. 09.2020- 09.10.2020") == {(2020, 9, 30), (2020, 10, 9)}
    assert dates_of("până la 15 martie 2024") == {(2024, 3, 15)}
    assert dates_of("până la 15.12") == {(None, 12, 15)}
    assert dates_of("8/7/21") == {(2021, 7, 8)}


def dates_of(text: str) -> set[tuple[int | None, int, int]]:
    return consult.dates_in(text)


def test_values_must_be_quoted_and_the_dates_written_in_the_quote() -> None:
    answer = {
        "opens_on": item("2026-09-23", "se pot depune în perioada: 23.09.2026 - 05.10.2026"),
        "closes_on": item(
            "2026-10-06", "în perioada: 23.09.2026 - 05.10.2026", days_after_opening=None
        ),
        "public_meeting_at": item("2026-10-01T15:00", "în data de 1 octombrie 2026, ora 15.00"),
        "submit_email": item("infopublice@brasovcity.ro", "e-mail: infopublice@brasovcity.ro"),
        "submit_address": item("B-dul. Eroilor nr. 8", "la sediul instituției, B-dul. Eroilor"),
        "submit_instructions": item("se depun la ghișeul 5", "se depun la ghișeul 5"),
    }
    found = consult.check(answer, [PAGE])
    assert found.values["opens_on"].value == date(2026, 9, 23)
    assert found.values["public_meeting_at"].value == datetime(2026, 10, 1, 15, 0)
    assert found.values["submit_email"].value == "infopublice@brasovcity.ro"
    assert found.values["submit_address"].value == "B-dul. Eroilor nr. 8"
    assert found.dropped == {
        "closes_on": "date not in the quote",  # 06.10 isn't written; 05.10 is
        "submit_instructions": "quote not on the cited page",
    }


def test_personal_emails_and_unmatched_day_counts_are_dropped() -> None:
    page = "Data afișării: 08.07.2021. Observații în termen de 15 zile. " + PAGE
    answer = {
        "opens_on": item("2021-07-08", "Data afișării: 08.07.2021"),
        "closes_on": item("2021-07-30", "în termen de 15 zile", days_after_opening=15),
        "submit_email": item("ion.pop@gmail.com", "Ion Pop, ion.pop@gmail.com"),
    }
    found = consult.check(answer, [page])
    assert found.dropped == {
        "submit_email": "personal email",
        "closes_on": "day count doesn't match the opening date",
    }
    answer["closes_on"] = item("2021-07-23", "în termen de 15 zile", days_after_opening=15)
    assert consult.check(answer, [page]).values["closes_on"].value == date(2021, 7, 23)


def test_golden_set_accuracy_from_recorded_answers() -> None:
    fs = FixtureSet("brasov")
    result = evals.consult_run(fs, evals.consult_replay(fs, FIELDS_MODEL), model=FIELDS_MODEL)
    wrong = {p.slug: p.wrong for p in result.projects if p.wrong}
    assert result.scored >= 15
    assert result.accuracy >= evals.CONSULT_REQUIRED_ACCURACY, wrong


class Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: bytes, content_type: str = "") -> None:
        del content_type
        self.objects[key] = data

    def get(self, key: str) -> bytes:
        return self.objects[key]


class FakeReader:
    model = "fake-model"
    prompt_version = consult.PROMPT_VERSION

    def __init__(self, answer: dict[str, Any]) -> None:
        self.answer, self.calls = answer, 0

    def __call__(self, text: str) -> JsonAnswer:
        self.calls += 1
        assert '<page n="1">' in text
        return JsonAnswer(self.answer, self.model, 1500, 300, 0.005)


def project_with_notice(conn: psycopg.Connection[Any], store: Store) -> str:
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """insert into project (jurisdiction_id, slug, kind, status, title, review_state)
               values (1, 'puz-test', 'puz', 'in_public_consultation', 'PUZ test',
                   'auto_published') returning id"""
        )
        row = cur.fetchone()
        assert row
        content = b"%PDF-1.7 anunt"
        key = f"text/testcity/{hashlib.sha256(content).hexdigest()}.v1.json"
        store.put(key, json.dumps({"pages": [{"n": 1, "text": PAGE}]}).encode())
        doc_id, _ = store_raw_document(
            cur, jurisdiction_id=1, city="testcity", url="https://city.test/anunt.pdf",
            content=content, content_type="application/pdf", fetched_at=datetime.now(UTC),
            upload=store.put, doc_type="anunt",
        )  # fmt: skip
        cur.execute("update raw_document set text_r2_key = %s where id = %s", (key, doc_id))
        cur.execute(
            """insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
               values (1, %s, %s, 'anunt')""",
            (row[0], doc_id),
        )
        return str(row[0])


def test_consult_stage_writes_one_row_per_notice_and_reruns_as_no_op(
    pg: psycopg.Connection[Any],
) -> None:
    pg.execute("update jurisdiction set timezone = 'Europe/Bucharest'")
    store = Store()
    project_with_notice(pg, store)
    reader = FakeReader(
        {
            "opens_on": item("2026-09-23", "în perioada: 23.09.2026 - 05.10.2026"),
            "closes_on": item(
                "2026-10-05", "în perioada: 23.09.2026 - 05.10.2026", days_after_opening=None
            ),
            "public_meeting_at": item("2026-10-01T15:00", "în data de 1 octombrie 2026, ora 15.00"),
            "submit_email": item("infopublice@brasovcity.ro", "e-mail: infopublice@brasovcity.ro"),
        }
    )
    first = consultations.run(pg, store, city="testcity", reader=reader)
    assert first.counts["consultations written"] == 1
    row = pg.execute(
        """select opens_on, closes_on, submit_email, public_meeting_at at time zone
               'Europe/Bucharest', page, details->'values'->'closes_on'->>'quote'
           from consultation"""
    ).fetchone()
    assert row == (
        date(2026, 9, 23), date(2026, 10, 5), "infopublice@brasovcity.ro",
        datetime(2026, 10, 1, 15, 0), 1, "în perioada: 23.09.2026 - 05.10.2026",
    )  # fmt: skip
    again = consultations.run(pg, store, city="testcity", reader=reader)
    assert reader.calls == 1
    assert again.counts["cached"] == 1
    assert again.counts["consultations unchanged"] == 1
    off = consultations.run(pg, store, city="testcity", reader=None)
    assert off.counts["consult: LLM off"] == 1

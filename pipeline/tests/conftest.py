"""Shared fixtures. `pg` gives a throwaway PostGIS database with the Drizzle migrations applied;
tests that use it skip when TEST_DATABASE_URL is unset (CI always sets it)."""

import json
import os
import re
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from mdu.core.env import REPO_ROOT, load_env

MIGRATIONS = REPO_ROOT / "packages" / "db" / "migrations"


def apply_migrations(conn: psycopg.Connection[Any]) -> None:
    journal = json.loads((MIGRATIONS / "meta" / "_journal.json").read_text(encoding="utf-8"))
    for entry in journal["entries"]:
        sql = (MIGRATIONS / f"{entry['tag']}.sql").read_text(encoding="utf-8")
        for statement in re.split(r"-->\s*statement-breakpoint", sql):
            if statement.strip():
                conn.execute(statement)  # type: ignore[call-overload]


@pytest.fixture
def pg() -> Iterator[psycopg.Connection[Any]]:
    load_env()
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        if os.environ.get("CI"):
            pytest.fail("TEST_DATABASE_URL must be set on CI; database tests may not skip there")
        pytest.skip("TEST_DATABASE_URL not set")
    name = f"mdu_py_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')  # type: ignore[call-overload]
    parts = urlsplit(admin_url)
    url = urlunsplit(parts._replace(path=f"/{name}"))
    try:
        with psycopg.connect(url, autocommit=True) as conn:
            apply_migrations(conn)
            conn.execute(
                "insert into jurisdiction (slug, name, county) "
                "values ('testcity', 'Test City', 'Test')"
            )
            yield conn
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')  # type: ignore[call-overload]

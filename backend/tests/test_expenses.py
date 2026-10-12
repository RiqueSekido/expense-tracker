from decimal import Decimal
import os
from pathlib import Path
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_session
from app.main import app


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)

    def test_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = test_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


def create(client, amount="10.00", date="2026-10-04", **overrides):
    return client.post("/api/expenses", json={
        "description": " Mercado ", "amount": amount,
        "date": date, "category": "Alimentação", **overrides,
    })


def test_create_filter_summary_and_delete(client):
    first = create(client, "0.10", "2026-10-01")
    assert first.status_code == 201
    assert first.json()["description"] == "Mercado"
    second = create(client, "0.20", "2026-10-31")
    create(client, "100.00", "2026-09-30")
    create(client, "100.00", "2026-11-01")
    items = client.get("/api/expenses", params={"month": "2026-10"}).json()
    assert [item["id"] for item in items] == [second.json()["id"], first.json()["id"]]
    summary = client.get("/api/expenses/summary", params={"month": "2026-10"}).json()
    assert Decimal(summary["total"]) == Decimal("0.30")
    assert summary["count"] == 2
    assert client.delete(f'/api/expenses/{first.json()["id"]}').status_code == 204
    assert client.delete(f'/api/expenses/{first.json()["id"]}').status_code == 404
    assert len(client.get("/api/expenses?month=2026-10").json()) == 1


@pytest.mark.parametrize("amount", ["0", "-1", "1.001", "10000000000.00", "NaN", "Infinity"])
def test_invalid_amount(client, amount):
    assert create(client, amount).status_code == 422


@pytest.mark.parametrize("overrides", [
    {"description": "  "}, {"category": ""}, {"date": "2026-02-30"},
])
def test_invalid_fields(client, overrides):
    assert create(client, **overrides).status_code == 422


@pytest.mark.parametrize("month", ["2026-00", "2026-13", "2026-1", "0000-01", "9999-12"])
def test_invalid_month(client, month):
    assert client.get("/api/expenses", params={"month": month}).status_code == 422


def test_empty_month_and_year_boundary(client):
    summary = client.get("/api/expenses/summary?month=2026-12").json()
    assert Decimal(summary["total"]) == 0
    assert summary["count"] == 0
    create(client, date="2026-12-31")
    create(client, date="2027-01-01")
    assert len(client.get("/api/expenses?month=2026-12").json()) == 1


def test_migration_upgrade_and_downgrade(tmp_path):
    database_url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    environment = {**os.environ, "DATABASE_URL": database_url}
    backend = Path(__file__).resolve().parents[1]
    for target, expected in [("head", True), ("base", False)]:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade" if expected else "downgrade", target],
            cwd=backend, env=environment, capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr
        engine = create_engine(database_url)
        assert inspect(engine).has_table("expenses") is expected
        engine.dispose()

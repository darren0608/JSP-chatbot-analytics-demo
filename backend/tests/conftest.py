import os
import sys
from pathlib import Path

# Test env must be set before app.config is imported.
os.environ["JSP_DATABASE_URL"] = "sqlite:///./test_jsp.db"
os.environ["JSP_LLM_PROVIDER"] = "local"
os.environ["JSP_EMBEDDING_PROVIDER"] = "local"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c


def signup(client, email="user@example.com", password="password123", consent=True):
    r = client.post("/api/auth/signup", json={
        "email": email, "password": password, "consent_analytics": consent,
    })
    assert r.status_code == 200, r.text
    return r.json()


def ingest_fixtures(client):
    from app.db import SessionLocal
    from app.ingestion.pipeline import ingest
    db = SessionLocal()
    try:
        return ingest(db)
    finally:
        db.close()


def parse_sse(body: str) -> list[dict]:
    import json
    events = []
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events

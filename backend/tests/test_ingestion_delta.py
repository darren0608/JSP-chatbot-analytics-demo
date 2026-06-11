from conftest import ingest_fixtures


def test_ingestion_is_delta_only(client):
    first = ingest_fixtures(client)
    assert first["new"] > 0
    assert first["chunks_upserted"] > 0

    # Acceptance criterion §13: re-run with no source changes => zero new chunks.
    second = ingest_fixtures(client)
    assert second["new"] == 0
    assert second["updated"] == 0
    assert second["chunks_upserted"] == 0
    assert second["unchanged"] == first["new"]


def test_chunks_carry_provenance(client):
    ingest_fixtures(client)
    from app.db import SessionLocal
    from app.models import Chunk
    db = SessionLocal()
    try:
        for chunk in db.query(Chunk).all():
            assert chunk.meta["source_url"]
            assert chunk.meta["content_type"]
            assert chunk.meta["fetched_at"]
            assert chunk.embedding is not None
    finally:
        db.close()


def test_search_endpoint(client):
    from conftest import signup
    ingest_fixtures(client)
    signup(client)
    r = client.get("/api/search", params={"q": "skills for a data analyst"})
    assert r.status_code == 200
    results = r.json()
    assert results
    assert results[0]["source_url"].startswith("fixture://")
    assert any("data analyst" in r0["title"].lower() for r0 in results[:3])

from conftest import ingest_fixtures, parse_sse, signup


def _make_admin(client, email="admin@example.com"):
    signup(client, email=email)
    from app.db import SessionLocal
    from app.models import User
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        user.role = "admin"
        db.commit()
    finally:
        db.close()
    # refresh session cookie with admin role
    client.post("/api/auth/login", json={"email": email, "password": "password123"})


def _chat(client, message):
    r = client.post("/api/chat", json={"message": message})
    assert r.status_code == 200
    return parse_sse(r.text)


def _run_analytics():
    from app.analytics.pipeline import analyze_messages, run_clustering
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        analyze_messages(db)
        return run_clustering(db)
    finally:
        db.close()


def test_consent_gate(client):
    """Acceptance §13: a user without consent_analytics produces NO rows in
    query_analysis."""
    ingest_fixtures(client)
    signup(client, email="noconsent@example.com", consent=False)
    _chat(client, "What skills do I need to become a data analyst?")
    _run_analytics()

    from app.db import SessionLocal
    from app.models import Entity, QueryAnalysis
    db = SessionLocal()
    try:
        assert db.query(QueryAnalysis).count() == 0
        assert db.query(Entity).count() == 0
    finally:
        db.close()


def test_intent_entities_clusters_and_drilldown(client):
    ingest_fixtures(client)
    signup(client, email="consenting@example.com", consent=True)
    queries = [
        "What skills do I need to become a data analyst?",
        "Which skills are required for a data analyst job?",
        "What courses can teach me SQL?",
        "Is there training for Python?",
        "How do I switch from marketing into data analytics?",
    ]
    # one conversation, like a real session — also exercises role×skill
    # co-occurrence which is computed per conversation
    conv_id = None
    for q in queries:
        r = client.post("/api/chat", json={"message": q, "conversation_id": conv_id})
        assert r.status_code == 200
        events = parse_sse(r.text)
        conv_id = next(e for e in events if e["type"] == "done")["conversation_id"]
    result = _run_analytics()
    assert result["clusters"] >= 1

    client.post("/api/auth/logout")
    _make_admin(client)

    overview = client.get("/api/admin/overview").json()
    assert overview["query_volume"] == len(queries)
    assert overview["analyzed"] == len(queries)
    intents = {i["label"] for i in overview["top_intents"]}
    assert "skills_for_role" in intents
    assert any(r["value"] == "data analyst" for r in overview["top_roles"])
    assert any(s["value"] in ("sql", "python") for s in overview["top_skills"])

    clusters = client.get("/api/admin/clusters").json()
    assert clusters["clusters"]
    detail = client.get(f"/api/admin/clusters/{clusters['clusters'][0]['id']}/messages").json()
    assert detail["messages"]  # drill-down to real (redacted) queries
    assert detail["messages"][0]["conversation_id"]

    points = client.get("/api/admin/projection").json()["points"]
    assert len(points) == len(queries)

    cooc = client.get("/api/admin/entities/cooccurrence").json()
    assert "data analyst" in cooc["roles"]


def test_content_gaps_capture_out_of_scope(client):
    ingest_fixtures(client)
    signup(client, email="consenting2@example.com", consent=True)
    _chat(client, "What is the best chicken rice stall?")
    _chat(client, "What is the best chicken rice stall?")
    _run_analytics()

    client.post("/api/auth/logout")
    _make_admin(client)
    gaps = client.get("/api/admin/gaps").json()
    assert gaps
    assert gaps[0]["count"] == 2
    assert "out_of_scope" in gaps[0]["intents"]


def test_pii_redacted_in_admin_views(client):
    ingest_fixtures(client)
    signup(client, email="consenting3@example.com", consent=True)
    _chat(client, "My name is Tan Ah Kow, NRIC S1234567D, email tan@x.com. "
                  "What skills do I need to become a data analyst?")
    _run_analytics()

    client.post("/api/auth/logout")
    _make_admin(client)
    convs = client.get("/api/admin/conversations").json()
    detail = client.get(f"/api/admin/conversations/{convs[0]['id']}").json()
    text = detail["messages"][0]["content"]
    assert "S1234567D" not in text
    assert "tan@x.com" not in text
    assert "[nric]" in text and "[email]" in text
    assert detail["messages"][0]["intent"] is not None


def test_taxonomy_promote(client):
    ingest_fixtures(client)
    signup(client, email="consenting4@example.com", consent=True)
    _chat(client, "What courses teach SQL?")
    _chat(client, "Which courses teach SQL well?")
    _run_analytics()

    client.post("/api/auth/logout")
    _make_admin(client)
    taxonomy = client.get("/api/admin/taxonomy").json()
    assert any(t["label"] == "skills_for_role" for t in taxonomy)

    clusters = client.get("/api/admin/clusters").json()["clusters"]
    if clusters:
        r = client.post("/api/admin/taxonomy/promote", json={
            "cluster_id": clusters[0]["id"], "label": "emergent_sql_courses",
            "keywords": ["sql course"],
        })
        assert r.status_code == 200
        taxonomy = client.get("/api/admin/taxonomy").json()
        promoted = next(t for t in taxonomy if t["label"] == "emergent_sql_courses")
        assert promoted["origin"] == "promoted"

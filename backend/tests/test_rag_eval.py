"""RAG eval harness (brief §11): gold question -> expected-source set, run in
CI so retrieval quality doesn't silently regress. Extend GOLD as the corpus
grows; the assertion is recall@k on source URLs."""
from conftest import ingest_fixtures, signup

GOLD = [
    ("What skills do I need to become a data analyst?",
     {"fixture://job_role/data-analyst"}),
    ("Are there courses for learning data analytics?",
     {"fixture://course/intro-data-analytics"}),
    ("How do I switch from marketing into data analytics?",
     {"fixture://career_pathway/marketing-to-data-analyst"}),
    ("What does a cybersecurity analyst do?",
     {"fixture://job_role/cybersecurity-analyst"}),
    ("Tell me about SQL",
     {"fixture://skill/sql"}),
]

RECALL_K = 4


def test_retrieval_recall_at_k(client):
    ingest_fixtures(client)
    signup(client)
    failures = []
    for question, expected in GOLD:
        r = client.get("/api/search", params={"q": question, "top_k": RECALL_K})
        got = {row["source_url"] for row in r.json()}
        if not expected & got:
            failures.append((question, expected, got))
    assert not failures, f"retrieval regressions: {failures}"

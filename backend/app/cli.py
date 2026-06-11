"""Operational CLI — the lightweight stand-in for a worker queue at prototype
scale (rationale for deviating from RQ/Celery in brief §3: a single scheduler
process avoids a Redis dependency; the batch functions are pure
`fn(db) -> stats` so they can be wrapped in RQ/Celery tasks unchanged).

Commands:
    python -m app.cli seed        # ingest fixtures + create admin/demo users + demo chats
    python -m app.cli ingest      # run ingestion (delta-only)
    python -m app.cli analyze     # intent/entity/embedding batch
    python -m app.cli cluster     # clustering run (new run_id)
    python -m app.cli scheduler   # loop: ingest + analyze + cluster every N hours
"""
import logging
import sys
import time

from .db import SessionLocal, init_db

log = logging.getLogger("jsp.cli")

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin12345"
DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo12345"

# Demo queries exercise every Insights view (intents, entities, clusters,
# content gaps). They are synthetic usage of the app itself — not JSP content.
DEMO_QUERIES = [
    "What skills do I need to become a data analyst?",
    "Which skills are required for a data analyst role?",
    "What courses can teach me SQL?",
    "Is there training for Python programming?",
    "How do I switch from marketing to data analytics?",
    "I want to change career to become a software developer",
    "What is the difference between a data analyst and a data scientist?",
    "What does a cybersecurity analyst do?",
    "What is the salary outlook for software developers?",
    "What's the best laksa recipe in Singapore?",
]


def seed() -> None:
    from .analytics.intents import ensure_seed_taxonomy
    from .analytics.pipeline import analyze_messages, run_clustering
    from .ingestion.pipeline import ingest
    from .models import Conversation, User
    from .rag.chat import stream_chat
    from .security import hash_password

    init_db()
    db = SessionLocal()
    try:
        stats = ingest(db)
        log.info("ingestion: %s", stats)
        ensure_seed_taxonomy(db)

        admin = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if not admin:
            admin = User(email=ADMIN_EMAIL, password_hash=hash_password(ADMIN_PASSWORD),
                         role="admin", consent_analytics=True)
            db.add(admin)
        demo = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if not demo:
            demo = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD),
                        role="user", consent_analytics=True)
            db.add(demo)
            db.commit()
            for q in DEMO_QUERIES:
                conv = Conversation(user_id=demo.id)
                db.add(conv)
                db.flush()
                for _ in stream_chat(db, conv, q):
                    pass
        db.commit()

        log.info("analytics: %s", analyze_messages(db))
        log.info("clustering: %s", run_clustering(db))
        log.info("seed complete. admin=%s/%s demo=%s/%s",
                 ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_EMAIL, DEMO_PASSWORD)
    finally:
        db.close()


def run_ingest(force: bool = False) -> None:
    from .ingestion.pipeline import ingest
    init_db()
    db = SessionLocal()
    try:
        print(ingest(db, force=force))
    finally:
        db.close()


def run_analyze() -> None:
    from .analytics.pipeline import analyze_messages
    init_db()
    db = SessionLocal()
    try:
        print(analyze_messages(db))
    finally:
        db.close()


def run_cluster() -> None:
    from .analytics.pipeline import analyze_messages, run_clustering
    init_db()
    db = SessionLocal()
    try:
        analyze_messages(db)
        print(run_clustering(db))
    finally:
        db.close()


def scheduler(interval_hours: float = 24.0) -> None:
    """Re-index + analytics on a schedule (brief §5: configurable re-index)."""
    while True:
        try:
            run_ingest()
            run_cluster()  # analyze + cluster
        except Exception:
            log.exception("scheduled batch failed; will retry next cycle")
        time.sleep(interval_hours * 3600)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "seed"
    if cmd == "seed":
        seed()
    elif cmd == "ingest":
        # --reembed: re-chunk + re-embed unchanged documents too (required
        # after switching the embedding provider/model).
        run_ingest(force="--reembed" in sys.argv[2:])
    elif cmd == "analyze":
        run_analyze()
    elif cmd == "cluster":
        run_cluster()
    elif cmd == "scheduler":
        hours = float(sys.argv[2]) if len(sys.argv) > 2 else 24.0
        scheduler(hours)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()

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

from .config import settings
from .db import SessionLocal, init_db

log = logging.getLogger("jsp.cli")

# Seed accounts come from config (JSP_ADMIN_EMAIL / JSP_ADMIN_PASSWORD /
# JSP_DEMO_EMAIL / JSP_DEMO_PASSWORD). The defaults are demo credentials —
# override them before seeding an instance you'll actually use.
ADMIN_EMAIL = settings.admin_email
ADMIN_PASSWORD = settings.admin_password
DEMO_EMAIL = settings.demo_email
DEMO_PASSWORD = settings.demo_password

_DEFAULT_PASSWORDS = {"admin12345", "demo12345"}

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

    if (settings.source_adapter != "fixture"
            and _DEFAULT_PASSWORDS & {ADMIN_PASSWORD, DEMO_PASSWORD}):
        log.warning(
            "Seeding a NON-FIXTURE instance with the default demo passwords. "
            "Set JSP_ADMIN_PASSWORD / JSP_DEMO_PASSWORD before using this "
            "instance for real."
        )

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
            # Demo-chat replay populates every Insights view. Skippable via
            # JSP_SEED_DEMO_CHATS=false — with a real LLM provider enabled,
            # each query is a billable API call.
            if settings.seed_demo_chats:
                for q in DEMO_QUERIES:
                    conv = Conversation(user_id=demo.id)
                    db.add(conv)
                    db.flush()
                    for _ in stream_chat(db, conv, q):
                        pass
        db.commit()

        log.info("analytics: %s", analyze_messages(db))
        log.info("clustering: %s", run_clustering(db))
        log.info("seed complete. admin=%s demo=%s (passwords from "
                 "JSP_ADMIN_PASSWORD / JSP_DEMO_PASSWORD)",
                 ADMIN_EMAIL, DEMO_EMAIL)
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

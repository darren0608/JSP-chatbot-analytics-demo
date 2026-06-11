"""Analytics batch pipeline (brief §9). Consent-gated: ONLY messages from
users with consent_analytics=true are processed — a non-consenting user
produces zero rows in query_analysis/entities (acceptance criterion §13).

`analyze_messages` is idempotent (skips already-processed messages) so it can
run nightly and/or near-real-time. `run_clustering` is re-runnable with a new
run_id each time; history is kept for trend comparison.
"""
import logging

from sqlalchemy.orm import Session

from ..models import (
    Cluster, Entity, Message, MessageCluster, QueryAnalysis, User, Conversation,
)
from ..providers import get_embedding_provider, get_llm_provider
from ..rag.chat import is_in_domain
from .clustering import cluster_embeddings, new_run_id
from .entities import extract_entities
from .intents import classify, classify_with_llm, ensure_seed_taxonomy
from .redaction import redact

log = logging.getLogger(__name__)


def _consented_user_messages(db: Session):
    return (
        db.query(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .join(User, Conversation.user_id == User.id)
        .filter(Message.role == "user", User.consent_analytics.is_(True))
    )


def analyze_messages(db: Session) -> dict:
    """Intent + entities + embedding for every unprocessed, consented user
    message."""
    ensure_seed_taxonomy(db)
    embedder = get_embedding_provider()

    processed_ids = {qa.message_id for qa in db.query(QueryAnalysis.message_id).all()}
    pending = [m for m in _consented_user_messages(db).all() if m.id not in processed_ids]

    from ..models import IntentTaxonomy
    labels = [t.label for t in db.query(IntentTaxonomy).filter(IntentTaxonomy.active.is_(True)).all()]

    count = 0
    for msg in pending:
        redacted = redact(msg.content)
        llm_result = classify_with_llm(redacted, labels)
        if llm_result:
            intent, confidence = llm_result
        else:
            intent, confidence = classify(db, redacted, is_in_domain(msg.content), msg.retrieval_score)

        db.add(QueryAnalysis(
            message_id=msg.id,
            intent_label=intent,
            intent_confidence=confidence,
            embedding=embedder.embed_one(redacted),
            retrieval_score=msg.retrieval_score,
            redacted_text=redacted,
        ))
        for ent in extract_entities(db, redacted):
            db.add(Entity(message_id=msg.id, **ent))
        count += 1

    db.commit()
    log.info("analyzed %d new user messages", count)
    return {"analyzed": count}


def run_clustering(db: Session) -> dict:
    """Cluster all analysed queries; label each cluster via the LLM provider.
    Returns the new run_id."""
    analyses = db.query(QueryAnalysis).filter(QueryAnalysis.embedding.isnot(None)).all()
    if not analyses:
        return {"run_id": None, "clusters": 0}

    run_id = new_run_id()
    embeddings = [list(a.embedding) for a in analyses]
    labels = cluster_embeddings(embeddings)

    llm = get_llm_provider()
    groups: dict[int, list[int]] = {}
    for idx, label in enumerate(labels):
        if label >= 0:
            groups.setdefault(label, []).append(idx)

    import numpy as np
    created = 0
    for _, idxs in sorted(groups.items()):
        texts = [analyses[i].redacted_text for i in idxs]
        sample = "\n".join(f'- "{t}"' for t in texts[:10])
        label_text = llm.complete(
            "Give a short (max 6 words) topic label for this group of user "
            f"queries about jobs/skills:\n{sample}\nLabel:", max_tokens=20,
        ).strip()[:120]
        centroid = np.array([embeddings[i] for i in idxs]).mean(axis=0)

        cluster = Cluster(
            label=label_text or "unlabelled",
            summary=f"{len(idxs)} queries. Samples: " + "; ".join(texts[:3])[:500],
            size=len(idxs),
            centroid=[float(v) for v in centroid],
            run_id=run_id,
        )
        db.add(cluster)
        db.flush()
        cn = np.linalg.norm(centroid) or 1.0
        for i in idxs:
            v = np.array(embeddings[i])
            sim = float(np.dot(v, centroid) / ((np.linalg.norm(v) or 1.0) * cn))
            db.add(MessageCluster(
                message_id=analyses[i].message_id, cluster_id=cluster.id,
                distance=round(1.0 - sim, 4),
            ))
        created += 1

    db.commit()
    log.info("clustering run %s: %d clusters", run_id, created)
    return {"run_id": run_id, "clusters": created}

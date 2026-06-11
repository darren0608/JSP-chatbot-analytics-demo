"""JSP Insights API (brief §10). All routes RBAC-gated to role=admin.
Every aggregate endpoint exposes the underlying (PII-redacted) messages so
charts drill down to real chats.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..analytics.clustering import project_2d
from ..analytics.pipeline import analyze_messages, run_clustering
from ..analytics.redaction import redact
from ..config import settings
from ..db import get_db
from ..deps import require_admin
from ..ingestion.pipeline import ingest
from ..models import (
    Cluster, Conversation, Entity, IntentTaxonomy, Message, MessageCluster,
    QueryAnalysis, User,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _date_range(date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc) if date_from else now - timedelta(days=30)
    end = (datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)) if date_to else now + timedelta(days=1)
    return start, end


def _analyses_in_range(db: Session, start: datetime, end: datetime):
    return (
        db.query(QueryAnalysis, Message)
        .join(Message, QueryAnalysis.message_id == Message.id)
        .filter(Message.created_at >= start, Message.created_at < end)
        .all()
    )


# ---------------------------------------------------------------- overview

@router.get("/overview")
def overview(date_from: str | None = Query(None), date_to: str | None = Query(None),
             db: Session = Depends(get_db)):
    start, end = _date_range(date_from, date_to)
    user_msgs = (
        db.query(Message).filter(Message.role == "user",
                                 Message.created_at >= start, Message.created_at < end).all()
    )
    conv_ids = {m.conversation_id for m in user_msgs}
    active_users = (
        db.query(func.count(func.distinct(Conversation.user_id)))
        .filter(Conversation.id.in_(conv_ids)).scalar() if conv_ids else 0
    )

    rows = _analyses_in_range(db, start, end)
    intent_counts = Counter(qa.intent_label for qa, _ in rows)

    msg_ids = [qa.message_id for qa, _ in rows]
    entities = db.query(Entity).filter(Entity.message_id.in_(msg_ids)).all() if msg_ids else []
    role_counts = Counter(e.value_normalized for e in entities if e.entity_type == "job_role")
    skill_counts = Counter(e.value_normalized for e in entities if e.entity_type == "skill")
    sector_counts = Counter(e.value_normalized for e in entities if e.entity_type == "sector")

    by_day: Counter = Counter()
    for m in user_msgs:
        created = m.created_at if m.created_at.tzinfo else m.created_at.replace(tzinfo=timezone.utc)
        by_day[created.date().isoformat()] += 1

    return {
        "query_volume": len(user_msgs),
        "active_users": int(active_users or 0),
        "analyzed": len(rows),
        "top_intents": [{"label": k, "count": v} for k, v in intent_counts.most_common(5)],
        "top_roles": [{"value": k, "count": v} for k, v in role_counts.most_common(10)],
        "top_skills": [{"value": k, "count": v} for k, v in skill_counts.most_common(10)],
        "sector_split": [{"value": k, "count": v} for k, v in sector_counts.most_common(10)],
        "volume_by_day": [{"date": d, "count": c} for d, c in sorted(by_day.items())],
    }


# ------------------------------------------------------- clusters & scatter

def _latest_run_id(db: Session) -> str | None:
    row = db.query(Cluster.run_id).order_by(Cluster.created_at.desc()).first()
    return row[0] if row else None


@router.get("/clusters")
def list_clusters(run_id: str | None = None, db: Session = Depends(get_db)):
    run_id = run_id or _latest_run_id(db)
    if not run_id:
        return {"run_id": None, "clusters": []}
    clusters = db.query(Cluster).filter(Cluster.run_id == run_id).order_by(Cluster.size.desc()).all()
    total = sum(c.size for c in clusters) or 1
    return {
        "run_id": run_id,
        "clusters": [
            {"id": c.id, "label": c.label, "summary": c.summary, "size": c.size,
             "pct_of_total": round(100 * c.size / total, 1)}
            for c in clusters
        ],
    }


@router.get("/clusters/{cluster_id}/messages")
def cluster_messages(cluster_id: str, db: Session = Depends(get_db)):
    cluster = db.get(Cluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    rows = (
        db.query(MessageCluster, QueryAnalysis, Message)
        .join(QueryAnalysis, QueryAnalysis.message_id == MessageCluster.message_id)
        .join(Message, Message.id == MessageCluster.message_id)
        .filter(MessageCluster.cluster_id == cluster_id)
        .order_by(MessageCluster.distance)
        .all()
    )
    return {
        "cluster": {"id": cluster.id, "label": cluster.label, "summary": cluster.summary,
                    "size": cluster.size},
        "messages": [
            {"message_id": qa.message_id, "conversation_id": msg.conversation_id,
             "text": qa.redacted_text, "intent": qa.intent_label,
             "distance": mc.distance, "created_at": msg.created_at.isoformat()}
            for mc, qa, msg in rows
        ],
    }


@router.get("/projection")
def projection(run_id: str | None = None, db: Session = Depends(get_db)):
    """2D scatter of analysed query embeddings, coloured by cluster."""
    run_id = run_id or _latest_run_id(db)
    analyses = db.query(QueryAnalysis).filter(QueryAnalysis.embedding.isnot(None)).all()
    if not analyses:
        return {"run_id": run_id, "points": []}
    pts = project_2d([list(a.embedding) for a in analyses])

    cluster_of: dict[str, dict] = {}
    if run_id:
        rows = (
            db.query(MessageCluster, Cluster)
            .join(Cluster, Cluster.id == MessageCluster.cluster_id)
            .filter(Cluster.run_id == run_id).all()
        )
        cluster_of = {mc.message_id: {"id": c.id, "label": c.label} for mc, c in rows}

    return {
        "run_id": run_id,
        "points": [
            {"message_id": a.message_id, "x": x, "y": y,
             "text": a.redacted_text, "intent": a.intent_label,
             "cluster": cluster_of.get(a.message_id)}
            for a, (x, y) in zip(analyses, pts)
        ],
    }


# ---------------------------------------------------------------- entities

@router.get("/entities")
def entities_ranked(entity_type: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Entity)
    if entity_type:
        q = q.filter(Entity.entity_type == entity_type)
    counts: dict[tuple[str, str], int] = Counter()
    for e in q.all():
        counts[(e.entity_type, e.value_normalized)] += 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return [
        {"entity_type": t, "value": v, "count": c}
        for (t, v), c in ranked
    ]


@router.get("/entities/cooccurrence")
def cooccurrence(db: Session = Depends(get_db)):
    """role × skill co-occurrence at conversation level ('people asking about
    data analyst also ask about SQL'). Same-message pairs are rare; the same
    person's session is the meaningful unit."""
    rows = (
        db.query(Entity, Message.conversation_id)
        .join(Message, Message.id == Entity.message_id)
        .filter(Entity.entity_type.in_(["job_role", "skill"]))
        .all()
    )
    by_conv: dict[str, dict[str, set]] = defaultdict(lambda: {"job_role": set(), "skill": set()})
    for e, conv_id in rows:
        by_conv[conv_id][e.entity_type].add(e.value_normalized)

    pair_counts: Counter = Counter()
    for groups in by_conv.values():
        for role in groups["job_role"]:
            for skill in groups["skill"]:
                pair_counts[(role, skill)] += 1

    roles = sorted({r for r, _ in pair_counts})
    skills = sorted({s for _, s in pair_counts})
    matrix = [[pair_counts.get((r, s), 0) for s in skills] for r in roles]
    return {"roles": roles, "skills": skills, "matrix": matrix}


@router.get("/entities/{entity_type}/{value}/messages")
def entity_messages(entity_type: str, value: str, db: Session = Depends(get_db)):
    rows = (
        db.query(Entity, QueryAnalysis, Message)
        .join(QueryAnalysis, QueryAnalysis.message_id == Entity.message_id)
        .join(Message, Message.id == Entity.message_id)
        .filter(Entity.entity_type == entity_type, Entity.value_normalized == value)
        .order_by(Message.created_at.desc())
        .all()
    )
    return [
        {"message_id": qa.message_id, "conversation_id": msg.conversation_id,
         "text": qa.redacted_text, "intent": qa.intent_label,
         "created_at": msg.created_at.isoformat()}
        for _, qa, msg in rows
    ]


# ------------------------------------------------------ conversation viewer

@router.get("/conversations")
def admin_conversations(search: str | None = None, limit: int = Query(50, le=200),
                        db: Session = Depends(get_db)):
    q = db.query(Conversation).order_by(Conversation.updated_at.desc())
    convs = []
    for conv in q.limit(500).all():
        if search:
            hay = (conv.title + " " + " ".join(m.content for m in conv.messages)).lower()
            if search.lower() not in hay:
                continue
        convs.append({
            "id": conv.id, "title": redact(conv.title),
            "message_count": len(conv.messages),
            "updated_at": conv.updated_at.isoformat(),
        })
        if len(convs) >= limit:
            break
    return convs


@router.get("/conversations/{conversation_id}")
def admin_conversation_detail(conversation_id: str, db: Session = Depends(get_db)):
    conv = db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msg_ids = [m.id for m in conv.messages]
    analyses = {qa.message_id: qa for qa in
                db.query(QueryAnalysis).filter(QueryAnalysis.message_id.in_(msg_ids)).all()} if msg_ids else {}
    ents: dict[str, list] = defaultdict(list)
    if msg_ids:
        for e in db.query(Entity).filter(Entity.message_id.in_(msg_ids)).all():
            ents[e.message_id].append({"type": e.entity_type, "value": e.value_normalized})
    return {
        "id": conv.id,
        "title": redact(conv.title),
        "messages": [
            {
                "id": m.id, "role": m.role, "content": redact(m.content),
                "created_at": m.created_at.isoformat(),
                "intent": analyses[m.id].intent_label if m.id in analyses else None,
                "intent_confidence": analyses[m.id].intent_confidence if m.id in analyses else None,
                "retrieval_score": m.retrieval_score,
                "entities": ents.get(m.id, []),
            }
            for m in conv.messages
        ],
    }


# -------------------------------------------------------------- content gaps

@router.get("/gaps")
def content_gaps(db: Session = Depends(get_db)):
    """Queries with poor retrieval or out_of_scope/low-confidence intent,
    grouped by redacted text, ranked by frequency — the content backlog feed."""
    analyses = db.query(QueryAnalysis).all()
    gaps = [
        qa for qa in analyses
        if (qa.retrieval_score is not None and qa.retrieval_score < settings.retrieval_min_score)
        or qa.intent_label == "out_of_scope"
        or qa.intent_confidence < 0.4
    ]
    grouped: dict[str, dict] = {}
    for qa in gaps:
        key = qa.redacted_text.strip().lower()
        g = grouped.setdefault(key, {
            "text": qa.redacted_text, "count": 0, "intents": Counter(),
            "min_retrieval_score": None, "message_ids": [],
        })
        g["count"] += 1
        g["intents"][qa.intent_label] += 1
        if qa.retrieval_score is not None:
            g["min_retrieval_score"] = (qa.retrieval_score if g["min_retrieval_score"] is None
                                        else min(g["min_retrieval_score"], qa.retrieval_score))
        g["message_ids"].append(qa.message_id)
    out = sorted(grouped.values(), key=lambda g: -g["count"])
    for g in out:
        g["intents"] = dict(g["intents"])
    return out


# ------------------------------------------------------------ job triggers

@router.post("/jobs/ingest")
def trigger_ingest(db: Session = Depends(get_db)):
    return ingest(db)


@router.post("/jobs/analyze")
def trigger_analyze(db: Session = Depends(get_db)):
    return analyze_messages(db)


@router.post("/jobs/cluster")
def trigger_cluster(db: Session = Depends(get_db)):
    analyze_messages(db)  # ensure everything is analysed first
    return run_clustering(db)


# ---------------------------------------------------------- taxonomy admin

class TaxonomyIn(BaseModel):
    label: str
    description: str = ""
    keywords: list[str] = []


class TaxonomyPatch(BaseModel):
    description: str | None = None
    keywords: list[str] | None = None
    active: bool | None = None


@router.get("/taxonomy")
def list_taxonomy(db: Session = Depends(get_db)):
    from ..analytics.intents import ensure_seed_taxonomy
    ensure_seed_taxonomy(db)
    return [
        {"id": t.id, "label": t.label, "description": t.description,
         "keywords": t.keywords, "origin": t.origin, "active": t.active}
        for t in db.query(IntentTaxonomy).order_by(IntentTaxonomy.created_at).all()
    ]


@router.post("/taxonomy")
def create_taxonomy(body: TaxonomyIn, db: Session = Depends(get_db)):
    if db.query(IntentTaxonomy).filter(IntentTaxonomy.label == body.label).first():
        raise HTTPException(status_code=409, detail="Label already exists")
    t = IntentTaxonomy(label=body.label, description=body.description,
                       keywords=body.keywords, origin="seed")
    db.add(t)
    db.commit()
    return {"id": t.id}


@router.patch("/taxonomy/{taxonomy_id}")
def update_taxonomy(taxonomy_id: str, body: TaxonomyPatch, db: Session = Depends(get_db)):
    t = db.get(IntentTaxonomy, taxonomy_id)
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if body.description is not None:
        t.description = body.description
    if body.keywords is not None:
        t.keywords = body.keywords
    if body.active is not None:
        t.active = body.active
    db.commit()
    return {"ok": True}


class PromoteRequest(BaseModel):
    cluster_id: str
    label: str
    keywords: list[str] = []


@router.post("/taxonomy/promote")
def promote_cluster(body: PromoteRequest, db: Session = Depends(get_db)):
    """Promote an emergent cluster into a named intent (brief §10.6)."""
    cluster = db.get(Cluster, body.cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    if db.query(IntentTaxonomy).filter(IntentTaxonomy.label == body.label).first():
        raise HTTPException(status_code=409, detail="Label already exists")
    t = IntentTaxonomy(
        label=body.label,
        description=f"Promoted from cluster '{cluster.label}' (run {cluster.run_id})",
        keywords=body.keywords, origin="promoted",
    )
    db.add(t)
    db.commit()
    return {"id": t.id}

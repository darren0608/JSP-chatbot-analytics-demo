"""Entity extraction + normalisation (brief §9.2).

Two lexicon sources:
1. ingested documents — every job_role/skill/sector/course document title
   becomes a known entity (so the lexicon grows with the corpus), with the
   document id as a provisional canonical_id;
2. a static alias seed for common phrasings/abbreviations.

`canonical_id` is the seam for linking to the official Skills Framework
taxonomy when the product owner supplies it.
"""
import re

from sqlalchemy.orm import Session

from ..models import Document

# alias -> (entity_type, normalized value)
ALIAS_SEED: dict[str, tuple[str, str]] = {
    "data analyst": ("job_role", "data analyst"),
    "data analytics": ("skill", "data analytics"),
    "data scientist": ("job_role", "data scientist"),
    "data engineer": ("job_role", "data engineer"),
    "business analyst": ("job_role", "business analyst"),
    "software developer": ("job_role", "software developer"),
    "software engineer": ("job_role", "software developer"),
    "programmer": ("job_role", "software developer"),
    "web developer": ("job_role", "software developer"),
    "cybersecurity analyst": ("job_role", "cybersecurity analyst"),
    "security analyst": ("job_role", "cybersecurity analyst"),
    "cloud engineer": ("job_role", "cloud engineer"),
    "ux designer": ("job_role", "ux designer"),
    "product manager": ("job_role", "product manager"),
    "nurse": ("job_role", "nurse"),
    "teacher": ("job_role", "teacher"),
    "sql": ("skill", "sql"),
    "python": ("skill", "python"),
    "excel": ("skill", "excel"),
    "javascript": ("skill", "javascript"),
    "java": ("skill", "java"),
    "machine learning": ("skill", "machine learning"),
    "data visualisation": ("skill", "data visualisation"),
    "data visualization": ("skill", "data visualisation"),
    "visualisation": ("skill", "data visualisation"),
    "visualization": ("skill", "data visualisation"),
    "statistics": ("skill", "statistics"),
    "communication": ("skill", "communication"),
    "project management": ("skill", "project management"),
    "cloud": ("skill", "cloud computing"),
    "networking": ("skill", "networking"),
    "git": ("skill", "git"),
    "tech": ("sector", "infocomm technology"),
    "it sector": ("sector", "infocomm technology"),
    "infocomm": ("sector", "infocomm technology"),
    "healthcare": ("sector", "healthcare"),
    "finance": ("sector", "financial services"),
    "marketing": ("sector", "marketing"),
}

_TYPE_FROM_DOC = {"job_role": "job_role", "skill": "skill", "sector": "sector", "course": "course"}


def _doc_lexicon(db: Session) -> dict[str, tuple[str, str, str | None]]:
    """alias -> (entity_type, normalized, canonical_id) from ingested docs."""
    lex: dict[str, tuple[str, str, str | None]] = {}
    docs = db.query(Document).filter(Document.content_type.in_(list(_TYPE_FROM_DOC))).all()
    for doc in docs:
        name = re.sub(r"^\[FIXTURE\]\s*", "", doc.title)
        name = re.sub(r"^(Job Role|Skill|Sector|Course):\s*", "", name, flags=re.I)
        name = re.sub(r"\s*\(.*\)$", "", name).strip().lower()
        if len(name) >= 2:
            lex[name] = (_TYPE_FROM_DOC[doc.content_type], name, doc.id)
    return lex


def extract_entities(db: Session, text: str) -> list[dict]:
    """Returns [{entity_type, value_raw, value_normalized, canonical_id}]."""
    lowered = " " + re.sub(r"[^a-z0-9 ]", " ", text.lower()) + " "
    lowered = re.sub(r"\s+", " ", lowered)

    lexicon: dict[str, tuple[str, str, str | None]] = {
        alias: (etype, norm, None) for alias, (etype, norm) in ALIAS_SEED.items()
    }
    lexicon.update(_doc_lexicon(db))

    found: dict[tuple[str, str], dict] = {}
    # longest aliases first so "data analyst" wins over "data"
    for alias in sorted(lexicon, key=len, reverse=True):
        etype, norm, canonical = lexicon[alias]
        if f" {alias} " in lowered or f" {alias}s " in lowered:
            key = (etype, norm)
            if key not in found:
                found[key] = {
                    "entity_type": etype, "value_raw": alias,
                    "value_normalized": norm, "canonical_id": canonical,
                }
            lowered = lowered.replace(f" {alias} ", " _ ")
    return list(found.values())

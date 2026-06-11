"""Intent classification (brief §9.1). Hybrid:
- seed taxonomy stored in `intent_taxonomy` (editable in JSP Insights),
- keyword/phrase scorer as the deterministic baseline,
- optional LLM zero-shot classifier when an approved provider is configured
  (JSP_LLM_PROVIDER != local) — the seam is `classify_with_llm`.
Emergent intents arrive via cluster promotion (taxonomy router).
"""
from sqlalchemy.orm import Session

from ..config import settings
from ..models import IntentTaxonomy
from ..providers.local import content_words

SEED_TAXONOMY: list[dict] = [
    {"label": "find_courses_for_skill", "description": "Looking for training/courses for a skill",
     "keywords": ["course", "courses", "training", "class", "learn", "certification", "certificate", "study"]},
    {"label": "skills_for_role", "description": "What skills a job role requires",
     "keywords": ["skills do i need", "skills for", "skills required", "what skills", "requirements for", "qualifications for", "need to become"]},
    {"label": "career_switch", "description": "Switching careers / transition planning",
     "keywords": ["switch", "career change", "transition", "move into", "change career", "pivot", "switching"]},
    {"label": "role_outlook_salary", "description": "Salary, demand, or outlook for a role",
     "keywords": ["salary", "pay", "earn", "demand", "outlook", "prospects", "future of", "growing"]},
    {"label": "funding_eligibility", "description": "Funding, subsidies, credit eligibility",
     "keywords": ["funding", "subsidy", "subsidies", "credit", "claim", "eligible", "eligibility", "grant", "sponsor"]},
    {"label": "compare_roles", "description": "Comparing two or more roles",
     "keywords": ["difference between", "compare", "versus", " vs ", "better career", "or a"]},
    {"label": "pathway_planning", "description": "Career pathway / progression planning",
     "keywords": ["pathway", "progression", "roadmap", "path to", "next step", "advance", "grow into"]},
    {"label": "general_info", "description": "General jobs/skills information", "keywords": []},
    {"label": "out_of_scope", "description": "Not about jobs/skills/careers/training", "keywords": []},
]


def ensure_seed_taxonomy(db: Session) -> None:
    existing = {t.label for t in db.query(IntentTaxonomy).all()}
    for item in SEED_TAXONOMY:
        if item["label"] not in existing:
            db.add(IntentTaxonomy(label=item["label"], description=item["description"],
                                  keywords=item["keywords"], origin="seed"))
    db.commit()


def classify(db: Session, text: str, in_domain: bool, retrieval_score: float | None) -> tuple[str, float]:
    """Returns (intent_label, confidence)."""
    if not in_domain and (retrieval_score or 0.0) < settings.retrieval_min_score:
        return "out_of_scope", 0.9

    lowered = text.lower()
    words = set(content_words(text))
    best_label, best_score = "general_info", 0.0
    for tax in db.query(IntentTaxonomy).filter(IntentTaxonomy.active.is_(True)).all():
        if not tax.keywords:
            continue
        hits = 0.0
        for kw in tax.keywords:
            if " " in kw:
                if kw in lowered:
                    hits += 2.0  # phrase match is strong signal
            elif kw in words:
                hits += 1.0
        if hits > best_score:
            best_label, best_score = tax.label, hits

    if best_score == 0.0:
        return "general_info", 0.35
    confidence = min(0.95, 0.45 + 0.15 * best_score)
    return best_label, round(confidence, 2)


def classify_with_llm(text: str, labels: list[str]) -> tuple[str, float] | None:
    """Zero-shot LLM classification seam. Only call when a non-local provider
    is approved & configured; returns None otherwise."""
    if settings.llm_provider == "local":
        return None
    from ..providers import get_llm_provider
    prompt = (
        "Classify the user query into exactly one intent label from this list: "
        f"{', '.join(labels)}.\nQuery: {text}\n"
        'Reply as JSON: {"intent_label": "...", "confidence": 0.0-1.0}'
    )
    import json
    try:
        raw = get_llm_provider().complete(prompt, max_tokens=100)
        data = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
        if data.get("intent_label") in labels:
            return data["intent_label"], float(data.get("confidence", 0.5))
    except Exception:
        return None
    return None

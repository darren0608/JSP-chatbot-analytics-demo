"""PII detection + redaction (brief §11). Applied before any chat content is
stored in analytics or shown in JSP Insights. Pattern-based: emails, phone
numbers, NRIC/FIN, long digit runs, and self-introductions by name. A
pattern-based redactor is not exhaustive — flag for review before production.
"""
import re

_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
    (re.compile(r"\b[STFGMstfgm]\d{7}[A-Za-z]\b"), "[nric]"),
    (re.compile(r"(?<!\d)(?:\+65[\s-]?)?[3689]\d{3}[\s-]?\d{4}(?!\d)"), "[phone]"),
    (re.compile(r"\b\d{6,}\b"), "[number]"),
    (re.compile(r"\b(?:my name is|i am called|i'm called)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*",
                re.IGNORECASE), "my name is [name]"),
]


def redact(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text

"""Heading-aware chunking, ~500–800 token target (brief §5).
Token estimate: words ≈ 0.75 tokens⁻¹, good enough for budgeting."""
import re


def _est_tokens(text: str) -> int:
    return max(1, int(len(text.split()) / 0.75))


def chunk_text(text: str, target_tokens: int = 650) -> list[str]:
    # Split on markdown-ish headings first, then paragraphs.
    sections = re.split(r"\n(?=#{1,4}\s)|\n(?=[A-Z][^\n]{0,80}\n[-=]{3,})", text)
    chunks: list[str] = []
    buf = ""
    for section in sections:
        for para in re.split(r"\n\s*\n", section):
            para = para.strip()
            if not para:
                continue
            if buf and _est_tokens(buf) + _est_tokens(para) > target_tokens:
                chunks.append(buf.strip())
                buf = para
            else:
                buf = f"{buf}\n\n{para}" if buf else para
        # heading boundary: prefer to close the chunk here if it's big enough
        if buf and _est_tokens(buf) >= target_tokens * 0.6:
            chunks.append(buf.strip())
            buf = ""
    if buf.strip():
        chunks.append(buf.strip())
    return chunks or ([text.strip()] if text.strip() else [])

import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _summarize_groq(text: str) -> dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    prompt = f"""회의 전사 내용을 바탕으로 요약본을 작성해줘.
반드시 아래 JSON 형식으로만 응답해야 해:
{{
    "abstract": "회의의 전체적인 내용을 2~3문장으로 요약",
    "decisions": ["결정된 사항 1", "결정된 사항 2"],
    "action_items": ["할 일 1 (담당자)", "할 일 2 (기한)"]
}}

회의 내용:
{text[:6000]}"""

    response = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "llama3-8b-8192",
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        },
        timeout=60.0,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def _pick_lines_by_keywords(lines: list[str], keywords: tuple[str, ...], limit: int = 5) -> list[str]:
    picked: list[str] = []
    for line in lines:
        lower = line.lower()
        if any(keyword in lower for keyword in keywords):
            picked.append(line)
        if len(picked) >= limit:
            break
    return picked


def build_summary_payload(transcript_lines: list[str]) -> dict[str, str]:
    cleaned = [line.strip() for line in transcript_lines if line.strip()]
    if not cleaned:
        return {
            "abstract": "전사 내용이 비어 있습니다.",
            "decisions_json": "[]",
            "action_items_json": "[]",
        }

    full_text = " ".join(cleaned)

    try:
        result = _summarize_groq(full_text)
        abstract = result.get("abstract", "요약 생성 실패")
        decisions = result.get("decisions", [])
        action_items = result.get("action_items", [])
    except Exception as exc:
        logger.warning(f"LLM 요약 실패, 규칙 기반으로 전환: {exc}")
        abstract = " ".join(cleaned[:5])[:700]
        decisions = _pick_lines_by_keywords(
            cleaned,
            keywords=("결정", "확정", "합의", "decide", "decision"),
            limit=6,
        )
        action_items = _pick_lines_by_keywords(
            cleaned,
            keywords=("할 일", "todo", "action", "담당", "까지", "기한"),
            limit=8,
        )

    return {
        "abstract": abstract,
        "decisions_json": json.dumps(decisions, ensure_ascii=False),
        "action_items_json": json.dumps(action_items, ensure_ascii=False),
    }


def build_metadata_payload(title: str, transcript_lines: list[str]) -> dict[str, str]:
    text = f"{title} {' '.join(transcript_lines)}".lower()
    meeting_type = "general"
    if any(word in text for word in ("standup", "스탠드업", "데일리", "daily")):
        meeting_type = "standup"
    elif any(word in text for word in ("월간", "monthly", "리뷰", "review")):
        meeting_type = "review"
    elif any(word in text for word in ("영업", "sales", "고객", "client")):
        meeting_type = "sales"
    elif any(word in text for word in ("기획", "planning", "로드맵", "roadmap")):
        meeting_type = "planning"

    tags: list[str] = []
    keyword_tags = {
        "ai": ("ai", "인공지능", "llm"),
        "product": ("제품", "product", "기능"),
        "design": ("디자인", "ui", "ux"),
        "engineering": ("개발", "api", "backend", "frontend", "swift"),
        "sales": ("영업", "고객", "deal"),
        "hiring": ("채용", "면접", "recruit"),
    }
    for tag, keywords in keyword_tags.items():
        if any(keyword in text for keyword in keywords):
            tags.append(tag)

    if not tags:
        tags.append(meeting_type)

    return {
        "meeting_type": meeting_type,
        "tags_json": json.dumps(tags[:8], ensure_ascii=False),
    }

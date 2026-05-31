import logging
import os

import httpx

from shared.db import (
    add_transcript_segment,
    delete_transcript_segments,
    get_meeting,
    get_meeting_summary,
    list_transcript_segments,
    update_meeting_metadata,
    update_meeting_status,
    upsert_meeting_summary,
)
from worker.summarization import build_metadata_payload, build_summary_payload
from worker.transcription import transcribe_audio

logger = logging.getLogger(__name__)


def _notify_slack(meeting_title: str, abstract: str, action_items: list[str]) -> None:
    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")
    if not webhook_url:
        return
    items_text = "\n".join(f"• {a}" for a in action_items[:5]) or "없음"
    payload = {
        "text": f"✅ *회의록 완료: {meeting_title}*\n\n*요약*\n{abstract}\n\n*할 일*\n{items_text}",
    }
    try:
        httpx.post(webhook_url, json=payload, timeout=10.0)
    except Exception as exc:
        logger.warning(f"Slack 알림 실패: {exc}")


def process_meeting(meeting_id: str, template: str = "general") -> dict[str, str]:
    update_meeting_status(meeting_id=meeting_id, status="transcribing")
    try:
        meeting = get_meeting(meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        stored_path = meeting.get("stored_path")
        if not stored_path:
            raise ValueError("No stored file path for transcription")

        # 재처리 시 기존 세그먼트 삭제
        delete_transcript_segments(meeting_id)

        segments = transcribe_audio(str(stored_path))
        for seg in segments:
            add_transcript_segment(
                meeting_id=meeting_id,
                start_sec=float(seg["start_sec"]),
                end_sec=float(seg["end_sec"]),
                text=str(seg["text"]),
                speaker=seg.get("speaker"),  # type: ignore[arg-type]
            )

        update_meeting_status(meeting_id=meeting_id, status="summarizing")
        segment_rows = list_transcript_segments(meeting_id)
        lines = [str(seg["text"]) for seg in segment_rows]

        summary = build_summary_payload(lines, template=template)
        upsert_meeting_summary(
            meeting_id=meeting_id,
            abstract=summary["abstract"],
            decisions_json=summary["decisions_json"],
            action_items_json=summary["action_items_json"],
        )

        metadata = build_metadata_payload(str(meeting["title"]), lines)
        ai_title = summary.get("title", "").strip()
        update_meeting_metadata(
            meeting_id=meeting_id,
            meeting_type=metadata["meeting_type"],
            tags_json=metadata["tags_json"],
            title=ai_title if ai_title else None,
        )

        update_meeting_status(meeting_id=meeting_id, status="completed")

        # Slack 알림
        import json
        action_items = json.loads(summary["action_items_json"])
        _notify_slack(
            meeting_title=ai_title or str(meeting["title"]),
            abstract=summary["abstract"],
            action_items=action_items,
        )

        return {"meeting_id": meeting_id, "stage": "completed"}

    except Exception as exc:
        update_meeting_status(meeting_id=meeting_id, status="failed", last_error=str(exc))
        raise

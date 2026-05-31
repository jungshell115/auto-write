from shared.db import (
    add_transcript_segment,
    get_meeting,
    list_transcript_segments,
    update_meeting_metadata,
    upsert_meeting_summary,
    update_meeting_status,
)
from worker.summarization import build_metadata_payload, build_summary_payload
from worker.transcription import transcribe_audio


def process_meeting(
    meeting_id: str,
) -> dict[str, str]:
    update_meeting_status(meeting_id=meeting_id, status="transcribing")
    try:
        meeting = get_meeting(meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        stored_path = meeting.get("stored_path")
        if not stored_path:
            raise ValueError("No stored file path for transcription")

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
        summary = build_summary_payload(lines)
        upsert_meeting_summary(
            meeting_id=meeting_id,
            abstract=summary["abstract"],
            decisions_json=summary["decisions_json"],
            action_items_json=summary["action_items_json"],
        )
        metadata = build_metadata_payload(str(meeting["title"]), lines)
        update_meeting_metadata(
            meeting_id=meeting_id,
            meeting_type=metadata["meeting_type"],
            tags_json=metadata["tags_json"],
        )

        update_meeting_status(meeting_id=meeting_id, status="completed")
        return {"meeting_id": meeting_id, "stage": "completed"}
    except Exception as exc:
        update_meeting_status(meeting_id=meeting_id, status="failed", last_error=str(exc))
        raise

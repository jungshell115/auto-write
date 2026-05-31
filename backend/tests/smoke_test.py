import json
import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

with tempfile.TemporaryDirectory() as tmp:
    os.environ["DATA_DIR"] = tmp
    os.environ["DB_PATH"] = str(Path(tmp) / "app.db")

    from api.exporter import render_markdown, save_markdown, save_pdf
    from shared.db import (
        add_transcript_segment,
        create_meeting,
        create_share_link,
        get_meeting,
        get_meeting_summary,
        get_share_link,
        init_db,
        list_meetings,
        list_transcript_segments,
        update_meeting_metadata,
        upsert_meeting_summary,
    )

    init_db()
    meeting_id = "smoke-meeting"
    create_meeting(
        meeting_id=meeting_id,
        title="스모크 테스트 회의",
        meeting_type="planning",
        meeting_date="2026-05-31",
        source_filename="smoke.wav",
        stored_path=None,
        status="completed",
        participants_json=json.dumps(["Alice", "Bob"], ensure_ascii=False),
        tags_json=json.dumps(["product", "engineering"], ensure_ascii=False),
        privacy_level="private",
    )
    update_meeting_metadata(meeting_id, tags_json=json.dumps(["qa", "launch"], ensure_ascii=False))
    add_transcript_segment(meeting_id, 0.0, 2.5, "다음 릴리스 범위를 확정했습니다.", "Alice")
    upsert_meeting_summary(
        meeting_id=meeting_id,
        abstract="다음 릴리스의 범위와 담당자를 정리한 회의입니다.",
        decisions_json=json.dumps(["MVP 범위를 확정"], ensure_ascii=False),
        action_items_json=json.dumps(["Bob이 QA 체크리스트 작성"], ensure_ascii=False),
    )
    create_share_link("token-1", meeting_id, "viewer", None, None)

    meeting = get_meeting(meeting_id)
    summary = get_meeting_summary(meeting_id)
    segments = list_transcript_segments(meeting_id)
    assert meeting is not None
    assert summary is not None
    assert list_meetings(tag="qa")[0]["meeting_id"] == meeting_id
    share = get_share_link("token-1")
    assert share is not None
    assert share["meeting_id"] == meeting_id

    markdown = render_markdown(meeting, summary, segments)
    md_path = Path(tmp) / "export.md"
    pdf_path = Path(tmp) / "export.pdf"
    save_markdown(md_path, markdown)
    save_pdf(pdf_path, markdown)
    assert md_path.read_text(encoding="utf-8").startswith("# 스모크 테스트 회의")
    assert pdf_path.read_bytes().startswith(b"%PDF")

print("smoke test passed")

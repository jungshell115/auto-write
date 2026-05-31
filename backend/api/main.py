import json
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi import Query
from fastapi.staticfiles import StaticFiles
from redis import Redis
from rq import Queue
from rq.job import Job

from api.exporter import render_markdown, save_markdown, save_pdf
from shared.config import (
    APP_SECRET,
    EXPORT_DIR,
    MAX_AUDIO_MB,
    REDIS_URL,
    RQ_QUEUE,
    UPLOAD_DIR,
    WEB_DIR,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT_URL,
    R2_BUCKET_NAME,
)
from shared.db import (
    create_meeting,
    create_share_link,
    delete_transcript_segments,
    get_meeting,
    get_meeting_summary,
    get_share_link,
    get_stats,
    init_db,
    list_meetings,
    list_transcript_segments,
    update_meeting_metadata,
    update_meeting_status,
    update_summary_content,
    upsert_meeting_summary,
    update_job_info,
)
from shared.schemas import (
    CreateShareLinkRequest,
    JobStatusResponse,
    MeetingListResponse,
    MeetingStatusResponse,
    MeetingSummaryResponse,
    MeetingTranscriptResponse,
    ShareLinkResponse,
    StatsResponse,
    TranscriptSegmentResponse,
    UpdateMeetingMetadataRequest,
    UpdateSummaryRequest,
    UploadMeetingRequest,
    UploadMeetingResponse,
)
from worker.tasks import process_meeting


# ── Lifespan ──────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    Path(EXPORT_DIR).mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title="Auto Write API", version="0.2.0", lifespan=lifespan)
WEB_PATH = Path(WEB_DIR)
MAX_UPLOAD_BYTES = MAX_AUDIO_MB * 1024 * 1024


# ── Auth middleware ───────────────────────────────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if APP_SECRET and request.url.path.startswith("/v1/"):
        api_key = request.headers.get("X-App-Key", "")
        if api_key != APP_SECRET:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


# ── R2 helpers ────────────────────────────────────────────────
def get_r2_client():
    if not all([R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL]):
        return None
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def upload_to_r2(local_path: Path, object_key: str) -> None:
    client = get_r2_client()
    if not client:
        return
    try:
        client.upload_file(str(local_path), R2_BUCKET_NAME, object_key)
    except (BotoCoreError, ClientError) as exc:
        import logging
        logging.getLogger(__name__).warning(f"R2 upload failed: {exc}")


def get_redis() -> Redis:
    return Redis.from_url(REDIS_URL)


# ── Status helpers ────────────────────────────────────────────
STATUS_PROGRESS = {
    "queued": 10, "processing": 30, "transcribing": 60,
    "transcribed": 80, "summarizing": 90, "completed": 100, "failed": 100,
}


def _json_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def _meeting_response(meeting: dict) -> MeetingStatusResponse:
    return MeetingStatusResponse(
        **{k: v for k, v in meeting.items() if k not in ("participants_json", "tags_json")},
        progress_percent=STATUS_PROGRESS.get(str(meeting["status"]), 0),
        participants=_json_list(meeting.get("participants_json")),
        tags=_json_list(meeting.get("tags_json")),
        project_id=meeting.get("project_id"),
        privacy_level=str(meeting.get("privacy_level") or "private"),
    )


def _enqueue(meeting_id: str, background_tasks: BackgroundTasks, template: str = "general") -> str:
    job_id = f"local-{meeting_id}"
    try:
        redis_conn = get_redis()
        redis_conn.ping()
        queue = Queue(name=RQ_QUEUE, connection=redis_conn)
        job = queue.enqueue("worker.tasks.process_meeting", meeting_id, template)
        job_id = job.id
    except Exception:
        background_tasks.add_task(process_meeting, meeting_id, template)
    update_job_info(meeting_id=meeting_id, job_id=job_id)
    return job_id


# ── Static pages ──────────────────────────────────────────────
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def web_index() -> FileResponse:
    return FileResponse(str(WEB_PATH / "index.html"))


@app.get("/manifest.webmanifest", include_in_schema=False)
def web_manifest() -> FileResponse:
    return FileResponse(str(WEB_PATH / "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/sw.js", include_in_schema=False)
def service_worker() -> FileResponse:
    return FileResponse(str(WEB_PATH / "sw.js"), media_type="application/javascript")


# ── Meetings ──────────────────────────────────────────────────
@app.get("/v1/meetings", response_model=MeetingListResponse)
def get_meetings(
    meeting_type: str | None = None,
    date_from:    str | None = None,
    date_to:      str | None = None,
    q:            str | None = Query(default=None),
    tag:          str | None = None,
) -> MeetingListResponse:
    rows = list_meetings(meeting_type=meeting_type, date_from=date_from, date_to=date_to, query=q, tag=tag)
    return MeetingListResponse(meetings=[_meeting_response(r) for r in rows])


@app.post("/v1/meetings/upload-file", response_model=UploadMeetingResponse)
async def upload_meeting_file(
    background_tasks: BackgroundTasks,
    title:        str = Form(...),
    meeting_type: str = Form("general"),
    meeting_date: str = Form(...),
    template:     str = Form("general"),
    duration_sec: int = Form(0),
    live_notes:   str = Form("[]"),
    file: UploadFile = File(...),
) -> UploadMeetingResponse:
    meeting_id = str(uuid4())
    ext = Path(file.filename or "audio.bin").suffix
    saved_name = f"{meeting_id}{ext or '.bin'}"
    saved_path = Path(UPLOAD_DIR) / saved_name

    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"파일이 {MAX_AUDIO_MB}MB를 초과합니다. Groq API 제한입니다.")
    saved_path.write_bytes(contents)
    upload_to_r2(saved_path, saved_name)

    create_meeting(
        meeting_id=meeting_id, title=title, meeting_type=meeting_type,
        meeting_date=meeting_date, source_filename=file.filename or saved_name,
        stored_path=str(saved_path), status="queued",
        duration_sec=duration_sec if duration_sec > 0 else None,
        live_notes_json=live_notes,
    )
    job_id = _enqueue(meeting_id, background_tasks, template=template)
    return UploadMeetingResponse(meeting_id=meeting_id, job_id=job_id, status="queued")


@app.get("/v1/meetings/{meeting_id}", response_model=MeetingStatusResponse)
def get_meeting_status(meeting_id: str) -> MeetingStatusResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _meeting_response(meeting)


@app.patch("/v1/meetings/{meeting_id}", response_model=MeetingStatusResponse)
def update_meeting(meeting_id: str, payload: UpdateMeetingMetadataRequest) -> MeetingStatusResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    update_meeting_metadata(
        meeting_id=meeting_id,
        title=payload.title,
        meeting_type=payload.meeting_type,
        participants_json=json.dumps(payload.participants, ensure_ascii=False) if payload.participants is not None else None,
        tags_json=json.dumps(payload.tags, ensure_ascii=False) if payload.tags is not None else None,
        project_id=payload.project_id,
        privacy_level=payload.privacy_level,
    )
    updated = get_meeting(meeting_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _meeting_response(updated)


@app.post("/v1/meetings/{meeting_id}/retry", response_model=UploadMeetingResponse)
def retry_meeting(meeting_id: str, background_tasks: BackgroundTasks) -> UploadMeetingResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if meeting.get("status") not in ("failed", "completed"):
        raise HTTPException(status_code=400, detail="Only failed/completed meetings can be retried")
    if not meeting.get("stored_path"):
        raise HTTPException(status_code=400, detail="No audio file to reprocess")
    update_meeting_status(meeting_id=meeting_id, status="queued", last_error=None)
    job_id = _enqueue(meeting_id, background_tasks)
    return UploadMeetingResponse(meeting_id=meeting_id, job_id=job_id, status="queued")


# ── Transcript & Summary ──────────────────────────────────────
@app.get("/v1/meetings/{meeting_id}/transcript", response_model=MeetingTranscriptResponse)
def get_meeting_transcript(meeting_id: str) -> MeetingTranscriptResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    segments = [TranscriptSegmentResponse(**s) for s in list_transcript_segments(meeting_id)]
    return MeetingTranscriptResponse(
        meeting_id=meeting_id, status=str(meeting["status"]),
        segment_count=len(segments), segments=segments,
    )


@app.get("/v1/meetings/{meeting_id}/summary", response_model=MeetingSummaryResponse)
def get_summary(meeting_id: str) -> MeetingSummaryResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    summary = get_meeting_summary(meeting_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not ready")
    return MeetingSummaryResponse(
        meeting_id=meeting_id, status=str(meeting["status"]),
        abstract=summary["abstract"],
        decisions=json.loads(summary["decisions_json"]),
        action_items=json.loads(summary["action_items_json"]),
    )


@app.patch("/v1/meetings/{meeting_id}/summary")
def update_summary(meeting_id: str, payload: UpdateSummaryRequest):
    if not get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    update_summary_content(
        meeting_id=meeting_id,
        abstract=payload.abstract,
        decisions_json=json.dumps(payload.decisions, ensure_ascii=False) if payload.decisions is not None else None,
        action_items_json=json.dumps(payload.action_items, ensure_ascii=False) if payload.action_items is not None else None,
    )
    return {"ok": True}


# ── Stats ──────────────────────────────────────────────────────
@app.get("/v1/stats", response_model=StatsResponse)
def stats() -> StatsResponse:
    data = get_stats()
    return StatsResponse(**data)


# ── Export ────────────────────────────────────────────────────
@app.get("/v1/meetings/{meeting_id}/export/markdown")
def export_markdown(meeting_id: str) -> FileResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    summary = get_meeting_summary(meeting_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not ready")
    segments = list_transcript_segments(meeting_id)
    content = render_markdown(meeting, summary, segments)
    output = Path(EXPORT_DIR) / f"{meeting_id}.md"
    save_markdown(output, content)
    return FileResponse(path=str(output), media_type="text/markdown", filename=f"{meeting_id}.md")


@app.get("/v1/meetings/{meeting_id}/export/pdf")
def export_pdf(meeting_id: str) -> FileResponse:
    meeting = get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    summary = get_meeting_summary(meeting_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not ready")
    segments = list_transcript_segments(meeting_id)
    content = render_markdown(meeting, summary, segments)
    output = Path(EXPORT_DIR) / f"{meeting_id}.pdf"
    try:
        from api.exporter import save_pdf
        save_pdf(output, content)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return FileResponse(path=str(output), media_type="application/pdf", filename=f"{meeting_id}.pdf")


# ── Share ──────────────────────────────────────────────────────
@app.post("/v1/meetings/{meeting_id}/share", response_model=ShareLinkResponse)
def create_meeting_share_link(meeting_id: str, payload: CreateShareLinkRequest) -> ShareLinkResponse:
    if not get_meeting(meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")
    token = secrets.token_urlsafe(18)
    expires_at = None
    if payload.expires_in_days:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)).isoformat()
    create_share_link(token=token, meeting_id=meeting_id, permission=payload.permission,
                      expires_at=expires_at, passcode=payload.passcode)
    return ShareLinkResponse(token=token, meeting_id=meeting_id, permission=payload.permission,
                             expires_at=expires_at, share_url=f"/share/{token}")


@app.get("/share/{token}/markdown")
def get_shared_markdown(token: str, passcode: str | None = None) -> FileResponse:
    share = get_share_link(token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")
    if share.get("expires_at") and datetime.fromisoformat(str(share["expires_at"])) < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link expired")
    if share.get("passcode") and share["passcode"] != passcode:
        raise HTTPException(status_code=403, detail="Invalid passcode")
    return export_markdown(str(share["meeting_id"]))


@app.get("/share/{token}/pdf")
def get_shared_pdf(token: str, passcode: str | None = None) -> FileResponse:
    share = get_share_link(token)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")
    if share.get("expires_at") and datetime.fromisoformat(str(share["expires_at"])) < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link expired")
    if share.get("passcode") and share["passcode"] != passcode:
        raise HTTPException(status_code=403, detail="Invalid passcode")
    return export_pdf(str(share["meeting_id"]))


if WEB_PATH.exists():
    app.mount("/", StaticFiles(directory=str(WEB_PATH)), name="web")

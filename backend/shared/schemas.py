from pydantic import BaseModel, Field


class UploadMeetingRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    meeting_type: str = Field(default="general")
    meeting_date: str = Field(description="ISO-8601 date string")
    source_filename: str = Field(min_length=1)


class UploadMeetingResponse(BaseModel):
    meeting_id: str
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    detail: str | None = None


class MeetingStatusResponse(BaseModel):
    meeting_id: str
    title: str
    meeting_type: str
    meeting_date: str
    source_filename: str
    stored_path: str | None = None
    job_id: str | None = None
    status: str
    last_error: str | None = None
    progress_percent: int
    participants: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    project_id: str | None = None
    privacy_level: str = "private"
    duration_sec: int | None = None


class TranscriptSegmentResponse(BaseModel):
    speaker: str | None = None
    start_sec: float
    end_sec: float
    text: str


class MeetingTranscriptResponse(BaseModel):
    meeting_id: str
    status: str
    segment_count: int
    segments: list[TranscriptSegmentResponse]


class MeetingSummaryResponse(BaseModel):
    meeting_id: str
    status: str
    abstract: str
    decisions: list[str]
    action_items: list[str]


class MeetingListResponse(BaseModel):
    meetings: list[MeetingStatusResponse]


class UpdateMeetingMetadataRequest(BaseModel):
    title: str | None = None
    meeting_type: str | None = None
    participants: list[str] | None = None
    tags: list[str] | None = None
    project_id: str | None = None
    privacy_level: str | None = None


class UpdateSummaryRequest(BaseModel):
    abstract: str | None = None
    decisions: list[str] | None = None
    action_items: list[str] | None = None


class CreateShareLinkRequest(BaseModel):
    permission: str = Field(default="viewer")
    expires_in_days: int | None = Field(default=7, ge=1, le=365)
    passcode: str | None = None


class ShareLinkResponse(BaseModel):
    token: str
    meeting_id: str
    permission: str
    expires_at: str | None = None
    share_url: str


class StatsTypeCount(BaseModel):
    meeting_type: str
    count: int


class StatsResponse(BaseModel):
    total: int
    completed: int
    failed: int
    processing: int
    by_type: list[StatsTypeCount]
    this_week: int
    total_min: int = 0
    avg_min: int = 0

import logging
import os
import subprocess
import tempfile
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

GROQ_MAX_BYTES = 24 * 1024 * 1024   # 24 MB (Groq 한도 25MB, 여유 1MB)
COMPRESS_BITRATE = "32k"             # 32kbps mono 16kHz → 약 14MB/시간
CHUNK_DURATION_SEC = 1200            # 20분 단위 분할 (압축 후에도 클 경우)


# ── ffmpeg 유틸 ───────────────────────────────────────────────

def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _compress_audio(input_path: Path) -> Path:
    """음성 파일을 32kbps mono 16kHz로 재인코딩해 크기를 줄입니다."""
    out = input_path.parent / f"{input_path.stem}_compressed.mp3"
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(input_path),
            "-ar", "16000",   # 16kHz — 음성 인식에 충분
            "-ac", "1",       # 모노
            "-b:a", COMPRESS_BITRATE,
            str(out),
        ],
        capture_output=True, check=True,
    )
    return out


def _get_duration_sec(path: Path) -> float:
    """ffprobe로 오디오 길이를 초 단위로 반환합니다."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip() or "0")


def _split_audio(path: Path, chunk_sec: int = CHUNK_DURATION_SEC) -> list[Path]:
    """오디오를 chunk_sec 단위로 분할합니다."""
    total = _get_duration_sec(path)
    chunks: list[Path] = []
    start = 0.0
    i = 0
    while start < total:
        out = path.parent / f"{path.stem}_part{i}{path.suffix}"
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(path),
                "-ss", str(start), "-t", str(chunk_sec),
                "-c", "copy", str(out),
            ],
            capture_output=True, check=True,
        )
        chunks.append(out)
        start += chunk_sec
        i += 1
    return chunks


# ── Groq STT 호출 ─────────────────────────────────────────────

def _call_groq(file_path: Path, api_key: str) -> list[dict]:
    """단일 파일을 Groq Whisper API로 전사합니다."""
    with open(file_path, "rb") as f:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": "whisper-large-v3", "response_format": "verbose_json"},
            files={"file": (file_path.name, f, _mime_type(file_path))},
            timeout=300.0,
        )
    response.raise_for_status()
    result = response.json()

    segments = result.get("segments") or []
    if not segments:
        text = result.get("text", "").strip()
        return [{"start_sec": 0.0, "end_sec": 0.0, "text": text, "speaker": None}]

    return [
        {
            "start_sec": float(seg.get("start", 0)),
            "end_sec":   float(seg.get("end",   0)),
            "text":      str(seg.get("text", "")).strip(),
            "speaker":   None,
        }
        for seg in segments
    ]


def _mime_type(path: Path) -> str:
    return {
        ".mp3":  "audio/mpeg",
        ".mp4":  "audio/mp4",
        ".m4a":  "audio/mp4",
        ".wav":  "audio/wav",
        ".webm": "audio/webm",
        ".ogg":  "audio/ogg",
        ".flac": "audio/flac",
    }.get(path.suffix.lower(), "audio/mpeg")


# ── 메인 진입점 ───────────────────────────────────────────────

def transcribe_audio(file_path: str) -> list[dict]:
    """
    음성 파일을 전사합니다.
    - 25 MB 이하: 직접 Groq 전송
    - 25 MB 초과 + ffmpeg 있음: 32kbps 압축 → 필요 시 분할 → 전사
    - 25 MB 초과 + ffmpeg 없음: 20MB 청크로 분할해 전사 (품질 저하 가능)
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    size = path.stat().st_size
    logger.info(f"Transcribing {path.name} ({size / 1024 / 1024:.1f} MB)")

    # ── 25MB 이하: 직접 전송 ──────────────────────────────────
    if size <= GROQ_MAX_BYTES:
        return _call_groq(path, api_key)

    # ── 25MB 초과: 압축 시도 ──────────────────────────────────
    tmp_files: list[Path] = []
    try:
        if _ffmpeg_available():
            logger.info(f"File too large ({size/1024/1024:.1f}MB). Compressing to {COMPRESS_BITRATE}...")
            compressed = _compress_audio(path)
            tmp_files.append(compressed)

            # 압축 후에도 크면 분할
            if compressed.stat().st_size <= GROQ_MAX_BYTES:
                return _call_groq(compressed, api_key)

            logger.info("Still large after compression. Splitting into chunks...")
            chunks = _split_audio(compressed, CHUNK_DURATION_SEC)
            tmp_files.extend(chunks)
        else:
            # ffmpeg 없음: 바이트 단위 분할 (음질 저하 가능)
            logger.warning("ffmpeg not found. Splitting by bytes (quality may vary).")
            data = path.read_bytes()
            chunks = []
            for i in range(0, len(data), GROQ_MAX_BYTES):
                chunk_path = path.parent / f"{path.stem}_raw{i}{path.suffix}"
                chunk_path.write_bytes(data[i:i + GROQ_MAX_BYTES])
                chunks.append(chunk_path)
                tmp_files.append(chunk_path)

        # ── 분할 파일 순서대로 전사 & 타임스탬프 보정 ───────────
        all_segments: list[dict] = []
        time_offset = 0.0
        for chunk in chunks:
            try:
                segs = _call_groq(chunk, api_key)
                for seg in segs:
                    seg["start_sec"] = float(seg["start_sec"]) + time_offset
                    seg["end_sec"]   = float(seg["end_sec"])   + time_offset
                all_segments.extend(segs)
                if segs:
                    time_offset = float(segs[-1]["end_sec"])
            except Exception as e:
                logger.warning(f"Chunk {chunk.name} transcription failed: {e}")

        return all_segments

    finally:
        for f in tmp_files:
            try: f.unlink()
            except Exception: pass

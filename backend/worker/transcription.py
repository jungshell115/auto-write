import os
from pathlib import Path

import httpx


def transcribe_audio(file_path: str) -> list[dict[str, float | str | None]]:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    with open(file_path, "rb") as f:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": "whisper-large-v3", "response_format": "verbose_json"},
            files={"file": (path.name, f, _mime_type(path))},
            timeout=300.0,
        )
    response.raise_for_status()
    result = response.json()

    segments = result.get("segments") or []
    if not segments:
        full_text = result.get("text", "").strip()
        return [{"start_sec": 0.0, "end_sec": 0.0, "text": full_text, "speaker": None}]

    return [
        {
            "start_sec": float(seg.get("start", 0)),
            "end_sec": float(seg.get("end", 0)),
            "text": str(seg.get("text", "")).strip(),
            "speaker": None,
        }
        for seg in segments
    ]


def _mime_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".mp3": "audio/mpeg",
        ".mp4": "audio/mp4",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
    }.get(ext, "audio/mpeg")

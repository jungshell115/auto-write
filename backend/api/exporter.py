import json
from pathlib import Path


def render_markdown(
    meeting: dict[str, str | None],
    summary: dict[str, str],
    segments: list[dict[str, str | float | None]],
) -> str:
    decisions = json.loads(summary["decisions_json"])
    action_items = json.loads(summary["action_items_json"])

    lines: list[str] = []
    lines.append(f"# {meeting['title']}")
    lines.append("")
    lines.append("## Meta")
    lines.append(f"- Meeting ID: `{meeting['meeting_id']}`")
    lines.append(f"- Type: `{meeting['meeting_type']}`")
    lines.append(f"- Date: `{meeting['meeting_date']}`")
    lines.append(f"- Status: `{meeting['status']}`")
    lines.append("")
    lines.append("## Summary")
    lines.append(summary["abstract"])
    lines.append("")
    lines.append("## Decisions")
    if decisions:
        lines.extend([f"- {item}" for item in decisions])
    else:
        lines.append("- (none)")
    lines.append("")
    lines.append("## Action Items")
    if action_items:
        lines.extend([f"- {item}" for item in action_items])
    else:
        lines.append("- (none)")
    lines.append("")
    lines.append("## Transcript")
    if segments:
        for seg in segments:
            start = float(seg["start_sec"])
            end = float(seg["end_sec"])
            speaker = str(seg["speaker"]) if seg.get("speaker") else "Speaker"
            text = str(seg["text"])
            lines.append(f"- [{start:.2f}s - {end:.2f}s] {speaker}: {text}")
    else:
        lines.append("- (empty)")
    lines.append("")
    return "\n".join(lines)


def save_markdown(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def save_pdf(path: Path, markdown_content: str) -> None:
    try:
        from reportlab.lib.pagesizes import A4  # type: ignore
        from reportlab.pdfgen import canvas  # type: ignore
    except Exception:
        _save_minimal_pdf(path, markdown_content)
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(path), pagesize=A4)
    _width, height = A4
    x = 40
    y = height - 40
    line_height = 14

    for raw_line in markdown_content.splitlines():
        line = raw_line if raw_line else " "
        if len(line) > 120:
            chunks = [line[i : i + 120] for i in range(0, len(line), 120)]
        else:
            chunks = [line]
        for chunk in chunks:
            if y < 40:
                pdf.showPage()
                y = height - 40
            pdf.drawString(x, y, chunk)
            y -= line_height

    pdf.save()


def _save_minimal_pdf(path: Path, markdown_content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = markdown_content.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").splitlines()
    visible = lines[:55]
    text_commands = ["BT", "/F1 11 Tf", "40 800 Td", "14 TL"]
    for line in visible:
        text_commands.append(f"({line[:100]}) Tj")
        text_commands.append("T*")
    text_commands.append("ET")
    stream = "\n".join(text_commands).encode("utf-8")

    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
        f"5 0 obj << /Length {len(stream)} >> stream\n".encode("utf-8") + stream + b"\nendstream endobj\n",
    ]

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(output))
        output.extend(obj)
    xref_start = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("utf-8"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    output.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode("utf-8")
    )
    path.write_bytes(output)

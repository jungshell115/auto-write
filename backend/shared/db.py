import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from shared.config import DB_PATH


def _conn() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meetings (
                meeting_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                meeting_type TEXT NOT NULL,
                meeting_date TEXT NOT NULL,
                source_filename TEXT NOT NULL,
                stored_path TEXT,
                job_id TEXT,
                status TEXT NOT NULL,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transcript_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL,
                speaker TEXT,
                start_sec REAL NOT NULL,
                end_sec REAL NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(meeting_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meeting_summaries (
                meeting_id TEXT PRIMARY KEY,
                abstract TEXT NOT NULL,
                decisions_json TEXT NOT NULL,
                action_items_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(meeting_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS share_links (
                token TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                permission TEXT NOT NULL,
                expires_at TEXT,
                passcode TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(meeting_id)
            )
            """
        )
        _ensure_column(conn, "meetings", "participants_json", "TEXT NOT NULL DEFAULT '[]'")
        _ensure_column(conn, "meetings", "tags_json", "TEXT NOT NULL DEFAULT '[]'")
        _ensure_column(conn, "meetings", "project_id", "TEXT")
        _ensure_column(conn, "meetings", "privacy_level", "TEXT NOT NULL DEFAULT 'private'")
        conn.commit()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column for row in columns):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def create_meeting(
    meeting_id: str,
    title: str,
    meeting_type: str,
    meeting_date: str,
    source_filename: str,
    stored_path: str | None,
    status: str,
    participants_json: str = "[]",
    tags_json: str = "[]",
    project_id: str | None = None,
    privacy_level: str = "private",
) -> None:
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO meetings (
                meeting_id, title, meeting_type, meeting_date,
                source_filename, stored_path, status,
                participants_json, tags_json, project_id, privacy_level,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                meeting_id,
                title,
                meeting_type,
                meeting_date,
                source_filename,
                stored_path,
                status,
                participants_json,
                tags_json,
                project_id,
                privacy_level,
                now,
                now,
            ),
        )
        conn.commit()


def update_job_info(meeting_id: str, job_id: str) -> None:
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            "UPDATE meetings SET job_id = ?, updated_at = ? WHERE meeting_id = ?",
            (job_id, now, meeting_id),
        )
        conn.commit()


def update_meeting_status(meeting_id: str, status: str, last_error: str | None = None) -> None:
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            """
            UPDATE meetings
            SET status = ?, last_error = ?, updated_at = ?
            WHERE meeting_id = ?
            """,
            (status, last_error, now, meeting_id),
        )
        conn.commit()


def get_meeting(meeting_id: str) -> dict[str, str | None] | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM meetings WHERE meeting_id = ?",
            (meeting_id,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def list_meetings(
    meeting_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    query: str | None = None,
    tag: str | None = None,
) -> list[dict[str, str | None]]:
    clauses: list[str] = []
    values: list[str] = []

    if meeting_type:
        clauses.append("meeting_type = ?")
        values.append(meeting_type)
    if date_from:
        clauses.append("meeting_date >= ?")
        values.append(date_from)
    if date_to:
        clauses.append("meeting_date <= ?")
        values.append(date_to)
    if query:
        clauses.append("(title LIKE ? OR source_filename LIKE ?)")
        values.extend([f"%{query}%", f"%{query}%"])
    if tag:
        clauses.append("tags_json LIKE ?")
        values.append(f"%{tag}%")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"""
        SELECT * FROM meetings
        {where}
        ORDER BY meeting_date DESC, created_at DESC
        LIMIT 200
    """
    with _conn() as conn:
        rows = conn.execute(sql, values).fetchall()
    return [dict(row) for row in rows]


def update_meeting_metadata(
    meeting_id: str,
    meeting_type: str | None = None,
    participants_json: str | None = None,
    tags_json: str | None = None,
    project_id: str | None = None,
    privacy_level: str | None = None,
) -> None:
    updates: list[str] = []
    values: list[str | None] = []
    if meeting_type is not None:
        updates.append("meeting_type = ?")
        values.append(meeting_type)
    if participants_json is not None:
        updates.append("participants_json = ?")
        values.append(participants_json)
    if tags_json is not None:
        updates.append("tags_json = ?")
        values.append(tags_json)
    if project_id is not None:
        updates.append("project_id = ?")
        values.append(project_id)
    if privacy_level is not None:
        updates.append("privacy_level = ?")
        values.append(privacy_level)

    if not updates:
        return

    updates.append("updated_at = ?")
    values.append(_now_iso())
    values.append(meeting_id)

    with _conn() as conn:
        conn.execute(
            f"UPDATE meetings SET {', '.join(updates)} WHERE meeting_id = ?",
            values,
        )
        conn.commit()


def add_transcript_segment(
    meeting_id: str,
    start_sec: float,
    end_sec: float,
    text: str,
    speaker: str | None = None,
) -> None:
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO transcript_segments (
                meeting_id, speaker, start_sec, end_sec, text, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (meeting_id, speaker, start_sec, end_sec, text, now),
        )
        conn.commit()


def list_transcript_segments(meeting_id: str) -> list[dict[str, str | float | None]]:
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT speaker, start_sec, end_sec, text
            FROM transcript_segments
            WHERE meeting_id = ?
            ORDER BY start_sec ASC
            """,
            (meeting_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_meeting_summary(
    meeting_id: str,
    abstract: str,
    decisions_json: str,
    action_items_json: str,
) -> None:
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO meeting_summaries (
                meeting_id, abstract, decisions_json, action_items_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                abstract = excluded.abstract,
                decisions_json = excluded.decisions_json,
                action_items_json = excluded.action_items_json,
                updated_at = excluded.updated_at
            """,
            (meeting_id, abstract, decisions_json, action_items_json, now, now),
        )
        conn.commit()


def get_meeting_summary(meeting_id: str) -> dict[str, str] | None:
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT meeting_id, abstract, decisions_json, action_items_json
            FROM meeting_summaries
            WHERE meeting_id = ?
            """,
            (meeting_id,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def create_share_link(
    token: str,
    meeting_id: str,
    permission: str,
    expires_at: str | None,
    passcode: str | None,
) -> None:
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO share_links (
                token, meeting_id, permission, expires_at, passcode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (token, meeting_id, permission, expires_at, passcode, _now_iso()),
        )
        conn.commit()


def get_share_link(token: str) -> dict[str, str | None] | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM share_links WHERE token = ?",
            (token,),
        ).fetchone()
    if not row:
        return None
    return dict(row)

# QA and Launch Checklist

## Backend Smoke

- `GET /health` returns `{"status":"ok"}`
- `GET /v1/meetings` returns filterable meeting rows
- `GET /v1/meetings/{id}` includes status, progress, tags, participants, privacy
- `GET /v1/meetings/{id}/transcript` returns ordered segments
- `GET /v1/meetings/{id}/summary` returns abstract, decisions, action items
- Markdown/PDF export endpoints return downloadable files
- Share links respect token existence, passcode, and expiry

## AI Quality

- Test at least 20 meetings across standup, planning, sales, review, general
- Track transcription failures and empty transcript rate
- Check whether decisions/action items are useful without manual edits
- Record user correction patterns for summary prompt/rule improvement

## Performance

- Track upload-to-completed time for 1, 10, 30, and 60 minute files
- Confirm long files stay in queued/transcribing states instead of blocking the app
- Confirm API still responds while a worker is processing

## App QA

- iPhone: record, stop, upload, poll, detail view
- iPad: split view layout and card readability
- Mac: localhost API connectivity and export links
- Empty, loading, failed, and completed states
- Voice permission denied state

## Security

- New meetings default to `private`
- Share links are explicit and read-only by default
- Expired links return `410`
- Passcode-protected links reject invalid passcodes
- Export documents do not include server file paths

## Run

```bash
backend/.venv/bin/python backend/tests/smoke_test.py
```

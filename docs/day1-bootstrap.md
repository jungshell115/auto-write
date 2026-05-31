# Day 1 Bootstrap

## What was initialized

- Monorepo directory structure
- FastAPI API server (`/health`, `/v1/meetings/upload`, `/v1/jobs/{job_id}`)
- Redis Queue worker placeholder
- Docker Compose for local run
- SQLite meeting metadata + 파일 업로드 저장 엔드포인트(`/v1/meetings/upload-file`)
- 회의 단위 상태 조회 엔드포인트(`/v1/meetings/{meeting_id}`)
- 전사 세그먼트 저장 및 조회 엔드포인트(`/v1/meetings/{meeting_id}/transcript`)
- 요약/결정/할 일 조회 엔드포인트(`/v1/meetings/{meeting_id}/summary`)

## How to run

```bash
docker compose -f infra/docker-compose.yml up --build
```

## Manual test

```bash
curl -X POST http://localhost:8000/v1/meetings/upload \
  -H "Content-Type: application/json" \
  -d '{
    "title": "주간 스탠드업",
    "meeting_type": "standup",
    "meeting_date": "2026-05-04",
    "source_filename": "standup.m4a"
  }'
```

응답으로 받은 `job_id`를 사용:

```bash
curl http://localhost:8000/v1/jobs/{job_id}
```

파일 업로드 API:

```bash
curl -X POST http://localhost:8000/v1/meetings/upload-file \
  -F "title=월간 회의" \
  -F "meeting_type=monthly" \
  -F "meeting_date=2026-05-04" \
  -F "file=@/absolute/path/to/sample.m4a"
```

응답으로 받은 `meeting_id` 상태 확인:

```bash
curl http://localhost:8000/v1/meetings/{meeting_id}
```

전사 세그먼트 확인:

```bash
curl http://localhost:8000/v1/meetings/{meeting_id}/transcript
```

요약 결과 확인:

```bash
curl http://localhost:8000/v1/meetings/{meeting_id}/summary
```

## Next implementation slice

- LLM 기반 요약 품질 개선(현재는 무료 룰 기반 요약)
- 공유용 Markdown/PDF 템플릿 렌더링 추가

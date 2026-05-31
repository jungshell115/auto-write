# Auto Write

Apple 기기에서 브라우저/PWA로 사용할 수 있는 0원(오픈소스/자체호스팅) AI 회의록 앱 모노레포입니다.

## Repository Layout

- `web`: App Store 없이 배포 가능한 웹/PWA 클라이언트 - **기본 구현 완료**
- `app/MeetingNotes`: SwiftUI 클라이언트 (iOS/iPadOS/macOS 멀티 타겟) - **보류**
- `backend/api`: FastAPI 서버 - **기능 구현 완료**
- `backend/worker`: 비동기 작업 워커(RQ) - **STT/요약 기본 구현 완료**
- `backend/shared`: 공통 스키마/설정 - **완료**
- `infra`: 로컬 개발용 인프라 설정(Docker Compose) - **완료**
- `docs`: 제품/기술 문서 - **완료**

## Quick Start (Backend)

1. Docker 데몬 실행
2. 루트에서:

```bash
docker compose -f infra/docker-compose.yml up --build
```

3. 웹앱/API 확인:

- web app: `http://localhost:8000`
- health: `http://localhost:8000/health`
- docs: `http://localhost:8000/docs`

## Initial API Endpoints

- `POST /v1/meetings/upload` 업로드 작업 생성(초기 버전은 실제 파일 저장 없이 Job만 생성)
- `POST /v1/meetings/upload-file` 실제 음성 파일 업로드 + 저장 + 작업 생성
- `GET /v1/meetings` 회의 목록/검색/필터 조회
- `PATCH /v1/meetings/{meeting_id}` 회의 메타데이터 수정
- `GET /v1/jobs/{job_id}` 작업 상태 조회
- `GET /v1/meetings/{meeting_id}` 회의 처리 상태 조회
- `GET /v1/meetings/{meeting_id}/transcript` 전사 세그먼트 조회
- `GET /v1/meetings/{meeting_id}/summary` 요약/결정/할 일 조회
- `GET /v1/meetings/{meeting_id}/export/markdown` 공유용 Markdown 내보내기
- `GET /v1/meetings/{meeting_id}/export/pdf` 공유용 PDF 내보내기
- `POST /v1/meetings/{meeting_id}/share` 공유 링크 생성
- `GET /share/{token}/markdown` 공유 링크 Markdown 조회
- `GET /share/{token}/pdf` 공유 링크 PDF 조회

## Verification

- Backend compile: `python3 -m compileall backend/api backend/shared backend/worker backend/tests`
- Backend smoke: `backend/.venv/bin/python backend/tests/smoke_test.py`
- Swift typecheck: `swiftc -typecheck app/MeetingNotes/MeetingNotesApp.swift app/MeetingNotes/ContentView.swift app/MeetingNotes/Views/MeetingDetailView.swift app/MeetingNotes/Resources/DesignSystem.swift app/MeetingNotes/Models/Meeting.swift app/MeetingNotes/Services/ApiService.swift app/MeetingNotes/Services/AudioRecorder.swift`
- PWA shell: `http://localhost:8000` serves `web/index.html`

## Next Milestones

- `faster-whisper` 모델/디바이스 동적 선택(CPU/MPS) 최적화
- 실제 회의 샘플 20개로 전사/요약 품질 측정
- PWA 홈 화면 추가 UX polish
- Xcode 프로젝트 타겟 구성은 App Store 출시 권한 확보 후 재검토

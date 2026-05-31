// ── 상태 ──────────────────────────────────────────────────────
const state = {
  meetings: [],
  selectedMeetingId: null,
  mediaRecorder: null,
  recordedChunks: [],
  pollTimer: null,
  recordTimerInterval: null,
  recordStartTime: null,
  demoMode: false,
  currentLat: null,
  currentLng: null,
  currentLocation: "",
  meetingDate: new Date().toISOString(),
};

// ── 회의 유형 ─────────────────────────────────────────────────
const MEETING_TYPE_LABELS = {
  general:  "일반",
  planning: "기획",
  hr:       "인사",
  external: "대외",
  other:    "기타",
  standup:  "스탠드업",
  review:   "리뷰",
  sales:    "영업",
};

// ── 상태 레이블 ───────────────────────────────────────────────
const STATUS_LABEL = {
  queued:       "대기",
  processing:   "처리중",
  transcribing: "전사중",
  transcribed:  "전사완료",
  summarizing:  "요약중",
  completed:    "완료",
  failed:       "오류",
};

// ── 데모 데이터 ───────────────────────────────────────────────
const demoMeeting = {
  meeting_id: "demo-meeting",
  title: "Q2 제품 로드맵 검토",
  meeting_type: "planning",
  meeting_date: new Date().toISOString(),
  status: "completed",
  progress_percent: 100,
  tags: ["product", "design", "engineering"],
  privacy_level: "private",
};
const demoSummary = {
  abstract: "웹/PWA 우선 출시 방향을 확정하고 앱스토어 없이 빠르게 검증 가능한 흐름을 정리했습니다. 다음 단계는 실제 회의 샘플로 전사/요약 품질을 측정하는 것입니다.",
  decisions: ["1차 출시는 웹/PWA로 진행", "SwiftUI 앱은 App Store 권한 확보 후 재검토"],
  action_items: ["실제 회의 샘플 20개로 품질 점검", "공유 링크 화면 polish"],
};
const demoTranscript = [
  { start_sec: 0, end_sec: 8, speaker: "Speaker 1", text: "앱스토어 출시 권한이 없으니 웹 기반으로 먼저 검증하는 것이 좋겠습니다." },
  { start_sec: 9, end_sec: 18, speaker: "Speaker 2", text: "동의합니다. 백엔드는 그대로 쓰고 PWA 화면을 붙이면 바로 사용자 테스트가 가능합니다." },
];

// ── 유틸 ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatSeconds(seconds) {
  const total = Math.floor(seconds || 0);
  const min = String(Math.floor(total / 60)).padStart(2, "0");
  const sec = String(total % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function meetingTypeLabel(type) {
  return MEETING_TYPE_LABELS[type] || type || "일반";
}

// ── 위치 관련 ─────────────────────────────────────────────────
const LOCATIONS_KEY = "auto_write_locations";
const MATCH_RADIUS_M = 250;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getStoredLocations() {
  try { return JSON.parse(localStorage.getItem(LOCATIONS_KEY) || "[]"); } catch { return []; }
}

function findNearbyLocation(lat, lng) {
  return getStoredLocations().find(
    (loc) => haversineDistance(lat, lng, loc.lat, loc.lng) < MATCH_RADIUS_M
  );
}

function saveLocationToMemory(lat, lng, name) {
  const locations = getStoredLocations();
  const existing = locations.find(
    (loc) => haversineDistance(lat, lng, loc.lat, loc.lng) < MATCH_RADIUS_M
  );
  if (existing) {
    existing.name = name;
    existing.count = (existing.count || 0) + 1;
  } else {
    locations.push({ lat, lng, name, count: 1 });
  }
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`,
      { headers: { "User-Agent": "AutoWrite/1.0" } }
    );
    const data = await res.json();
    const a = data.address || {};
    return (
      a.amenity || a.building || a.road ||
      a.neighbourhood || a.suburb || a.city_district ||
      a.city || "알 수 없는 위치"
    );
  } catch {
    return "위치 변환 실패";
  }
}

function renderLocationDisplay(name, isKnown) {
  const el = $("locationDisplay");
  if (isKnown) {
    el.innerHTML = `${escapeHtml(name)} <button class="location-action-btn" id="editLocationBtn">수정</button>`;
    $("editLocationBtn").addEventListener("click", editLocationName);
  } else {
    el.innerHTML = `${escapeHtml(name)} <button class="location-action-btn" id="saveLocationBtn">저장</button>`;
    $("saveLocationBtn").addEventListener("click", saveCurrentLocation);
  }
}

function editLocationName() {
  const name = prompt("장소 이름을 수정해 주세요:", state.currentLocation || "");
  if (name && name.trim()) {
    state.currentLocation = name.trim();
    saveLocationToMemory(state.currentLat, state.currentLng, name.trim());
    renderLocationDisplay(name.trim(), true);
  }
}

function saveCurrentLocation() {
  const name = prompt("이 장소를 기억할 이름을 입력해 주세요:", state.currentLocation || "");
  if (name && name.trim()) {
    state.currentLocation = name.trim();
    saveLocationToMemory(state.currentLat, state.currentLng, name.trim());
    renderLocationDisplay(name.trim(), true);
  }
}

async function detectLocation() {
  const el = $("locationDisplay");
  if (!navigator.geolocation) {
    el.textContent = "위치 기능 미지원";
    return;
  }
  el.textContent = "확인 중...";
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
    );
    const { latitude: lat, longitude: lng } = pos.coords;
    state.currentLat = lat;
    state.currentLng = lng;

    const nearby = findNearbyLocation(lat, lng);
    if (nearby) {
      state.currentLocation = nearby.name;
      renderLocationDisplay(nearby.name, true);
    } else {
      const address = await reverseGeocode(lat, lng);
      state.currentLocation = address;
      renderLocationDisplay(address, false);
    }
  } catch {
    el.textContent = "권한 없음 (탭하여 허용)";
  }
}

// ── 날짜/시간 자동 설정 ───────────────────────────────────────
function updateDatetimeDisplay() {
  const now = new Date();
  state.meetingDate = now.toISOString();
  $("datetimeDisplay").textContent = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).format(now);
}

// ── 서버 상태 ─────────────────────────────────────────────────
async function checkHealth() {
  try {
    await api("/health");
    state.demoMode = false;
    $("serverStatus").textContent = "서버 연결됨";
  } catch {
    state.demoMode = true;
    $("serverStatus").textContent = "데모 모드";
  }
}

// ── 회의 목록 ─────────────────────────────────────────────────
async function loadMeetings() {
  const params = new URLSearchParams();
  const query = $("searchInput").value.trim();
  const meetingType = $("filterType").value;
  if (query) params.set("q", query);
  if (meetingType) params.set("meeting_type", meetingType);

  try {
    const data = await api(`/v1/meetings${params.toString() ? `?${params}` : ""}`);
    state.demoMode = false;
    state.meetings = data.meetings;
  } catch {
    state.demoMode = true;
    state.meetings = [demoMeeting];
  }
  renderMeetings();

  if (state.selectedMeetingId) {
    const selected = state.meetings.find((m) => m.meeting_id === state.selectedMeetingId);
    if (selected) renderDetail(selected);
  }
}

function renderMeetings() {
  const list = $("meetingList");
  list.innerHTML = "";
  $("meetingCount").textContent = `${state.meetings.length}개`;

  if (!state.meetings.length) {
    list.innerHTML = `<div class="meeting-item"><p class="meeting-meta">아직 회의가 없습니다.</p></div>`;
    return;
  }

  state.meetings.forEach((meeting) => {
    const item = document.createElement("button");
    const isActive = meeting.meeting_id === state.selectedMeetingId;
    const isDone = meeting.status === "completed";
    const isError = meeting.status === "failed";
    item.className = `meeting-item ${isActive ? "active" : ""}`;
    item.type = "button";
    item.innerHTML = `
      <div class="meeting-topline">
        <span class="meeting-title">${escapeHtml(meeting.title)}</span>
        <span class="pill ${isDone ? "done" : isError ? "error" : ""}">${STATUS_LABEL[meeting.status] || meeting.status}</span>
      </div>
      <div class="meeting-meta">${formatDate(meeting.meeting_date)} · ${meetingTypeLabel(meeting.meeting_type)}</div>
      ${meeting.status !== "completed" ? `<progress value="${meeting.progress_percent || 0}" max="100"></progress>` : ""}
      <div class="tag-row">${(meeting.tags || []).slice(0, 4).map((t) => `<span>#${escapeHtml(t)}</span>`).join("")}</div>
    `;
    item.addEventListener("click", () => selectMeeting(meeting.meeting_id));
    list.appendChild(item);
  });
}

async function selectMeeting(meetingId) {
  state.selectedMeetingId = meetingId;
  const meeting = state.meetings.find((m) => m.meeting_id === meetingId) || (await api(`/v1/meetings/${meetingId}`));
  renderMeetings();
  await renderDetail(meeting);
}

async function renderDetail(meeting) {
  $("emptyDetail").classList.add("hidden");
  $("meetingDetail").classList.remove("hidden");
  $("detailTitle").textContent = meeting.title;
  $("detailMeta").textContent = `${formatDate(meeting.meeting_date)} · ${meetingTypeLabel(meeting.meeting_type)} · ${STATUS_LABEL[meeting.status] || meeting.status}`;
  $("markdownLink").href = `/v1/meetings/${meeting.meeting_id}/export/markdown`;
  $("pdfLink").href = `/v1/meetings/${meeting.meeting_id}/export/pdf`;
  $("shareResult").classList.add("hidden");
  $("shareButton").onclick = () => createShareLink(meeting.meeting_id);

  if (state.demoMode) {
    $("summaryText").textContent = demoSummary.abstract;
    renderList($("decisionsList"), demoSummary.decisions);
    renderList($("actionsList"), demoSummary.action_items);
    renderTranscript(demoTranscript);
    return;
  }

  try {
    const [summary, transcript] = await Promise.all([
      api(`/v1/meetings/${meeting.meeting_id}/summary`),
      api(`/v1/meetings/${meeting.meeting_id}/transcript`),
    ]);
    $("summaryText").textContent = summary.abstract || "요약 정보가 없습니다.";
    renderList($("decisionsList"), summary.decisions);
    renderList($("actionsList"), summary.action_items);
    renderTranscript(transcript.segments || []);
  } catch {
    $("summaryText").textContent = "회의 분석이 아직 완료되지 않았습니다.";
    renderList($("decisionsList"), []);
    renderList($("actionsList"), []);
    renderTranscript([]);
  }
}

function renderList(element, items) {
  element.innerHTML = "";
  if (!items || !items.length) {
    element.innerHTML = "<li>추출된 항목이 없습니다.</li>";
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  });
}

function renderTranscript(segments) {
  const list = $("transcriptList");
  list.innerHTML = "";
  if (!segments.length) {
    list.innerHTML = `<div class="segment"><p class="meeting-meta">전사 내용이 없습니다.</p></div>`;
    return;
  }
  segments.forEach((seg) => {
    const div = document.createElement("div");
    div.className = "segment";
    div.innerHTML = `
      <div class="segment-time">${formatSeconds(seg.start_sec)} - ${formatSeconds(seg.end_sec)} · ${escapeHtml(seg.speaker || "Speaker")}</div>
      <p>${escapeHtml(seg.text)}</p>
    `;
    list.appendChild(div);
  });
}

// ── 업로드 ────────────────────────────────────────────────────
function buildPlaceholderTitle() {
  const type = meetingTypeLabel($("meetingType").value);
  const loc = state.currentLocation ? ` · ${state.currentLocation}` : "";
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `${type} 회의${loc} ${time}`;
}

async function uploadFile(file) {
  if (state.demoMode) {
    alert("현재 데모 모드입니다. 백엔드 서버 연결 후 실제 업로드가 가능합니다.");
    return;
  }

  updateDatetimeDisplay();
  const userTitle = $("meetingTitle").value.trim();
  const title = userTitle || buildPlaceholderTitle();

  const form = new FormData();
  form.append("title", title);
  form.append("meeting_type", $("meetingType").value || "general");
  form.append("meeting_date", state.meetingDate);
  form.append("file", file, file.name || "recording.webm");

  $("uploadButton").disabled = true;
  try {
    const result = await api("/v1/meetings/upload-file", { method: "POST", body: form });
    state.selectedMeetingId = result.meeting_id;

    // 위치 기억 저장
    if (state.currentLat && state.currentLocation) {
      saveLocationToMemory(state.currentLat, state.currentLng, state.currentLocation);
    }

    await loadMeetings();
    startPolling();
  } finally {
    $("uploadButton").disabled = false;
  }
}

async function handleUploadClick() {
  const file = $("audioFile").files[0];
  if (!file) { alert("업로드할 음성 파일을 선택해 주세요."); return; }
  await uploadFile(file);
}

// ── 녹음 ──────────────────────────────────────────────────────
function startRecordTimer() {
  state.recordStartTime = Date.now();
  $("recordTimer").classList.remove("hidden");
  state.recordTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.recordStartTime) / 1000);
    $("recordTimer").textContent = formatSeconds(elapsed);
  }, 1000);
}

function stopRecordTimer() {
  clearInterval(state.recordTimerInterval);
  $("recordTimer").classList.add("hidden");
}

async function toggleRecording() {
  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("이 브라우저에서는 녹음을 지원하지 않습니다. 파일 업로드를 사용해 주세요.");
    return;
  }

  // 녹음 시작 직전 위치/시간 갱신
  updateDatetimeDisplay();
  await detectLocation();

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = [];
  state.mediaRecorder = new MediaRecorder(stream);
  state.mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  });
  state.mediaRecorder.addEventListener("stop", async () => {
    stream.getTracks().forEach((t) => t.stop());
    stopRecordTimer();
    const btn = $("recordButton");
    btn.classList.remove("recording");
    $("recordLabel").textContent = "회의 녹음 시작";
    const blob = new Blob(state.recordedChunks, { type: "audio/webm" });
    const file = new File([blob], `meeting-${Date.now()}.webm`, { type: "audio/webm" });
    await uploadFile(file);
  });
  state.mediaRecorder.start();
  $("recordButton").classList.add("recording");
  $("recordLabel").textContent = "녹음 중지 & 분석";
  startRecordTimer();
}

// ── 공유 링크 ─────────────────────────────────────────────────
async function createShareLink(meetingId) {
  if (state.demoMode) {
    $("shareResult").innerHTML = "데모 모드에서는 공유 링크를 생성할 수 없습니다.";
    $("shareResult").classList.remove("hidden");
    return;
  }
  try {
    const response = await api(`/v1/meetings/${meetingId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: "viewer", expires_in_days: 7 }),
    });
    const absolute = `${location.origin}${response.share_url}/markdown`;
    $("shareResult").innerHTML = `공유 링크: <a href="${absolute}" target="_blank">${absolute}</a>`;
  } catch {
    $("shareResult").textContent = "공유 링크 생성 실패. 서버 연결을 확인해 주세요.";
  }
  $("shareResult").classList.remove("hidden");
}

// ── 폴링 (지수 백오프) ────────────────────────────────────────
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  let interval = 3000;
  const tick = async () => {
    await loadMeetings();
    const hasRunning = state.meetings.some((m) => !["completed", "failed"].includes(m.status));
    if (!hasRunning) {
      clearInterval(state.pollTimer);
      // 완료 브라우저 알림
      if (Notification.permission === "granted") {
        new Notification("Auto Write", { body: "회의록 분석이 완료됐습니다 ✅", icon: "/icon.svg" });
      }
      return;
    }
    // 백오프: 3s → 5s → 10s → 15s 유지
    if (interval < 15000) {
      clearInterval(state.pollTimer);
      interval = Math.min(interval * 1.5, 15000);
      state.pollTimer = setInterval(tick, interval);
    }
  };
  state.pollTimer = setInterval(tick, interval);
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────
function bindEvents() {
  $("refreshButton").addEventListener("click", loadMeetings);
  $("filterButton").addEventListener("click", loadMeetings);
  $("uploadButton").addEventListener("click", handleUploadClick);
  $("recordButton").addEventListener("click", toggleRecording);
  $("searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadMeetings();
  });

  // 브라우저 알림 권한 요청 (완료 알림용)
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ── 부팅 ──────────────────────────────────────────────────────
async function boot() {
  bindEvents();
  updateDatetimeDisplay();
  detectLocation(); // 비동기, 기다리지 않음

  await checkHealth();
  await loadMeetings();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  $("serverStatus").textContent = "초기화 실패";
});

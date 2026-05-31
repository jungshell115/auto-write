// ── 상태 ──────────────────────────────────────────────────────
const state = {
  meetings: [],
  selectedMeetingId: null,
  selectedMeeting: null,
  selectedSummary: null,
  mediaRecorder: null,
  recordedChunks: [],
  pollTimer: null,
  pollInterval: 3000,
  recordTimerInterval: null,
  recordStartTime: null,
  demoMode: false,
  currentLat: null,
  currentLng: null,
  currentLocation: "",
  meetingDate: new Date().toISOString(),
  appKey: localStorage.getItem("app_key") || "",
};

// ── 상수 ──────────────────────────────────────────────────────
const MAX_FILE_MB = 24;
const LOCATIONS_KEY = "auto_write_locations";
const MATCH_RADIUS_M = 250;

const MEETING_TYPE_LABELS = {
  general: "일반", planning: "기획", hr: "인사",
  external: "대외", other: "기타", standup: "스탠드업",
  review: "리뷰", sales: "영업",
};

const STATUS_LABEL = {
  queued: "대기", processing: "처리중", transcribing: "전사중",
  transcribed: "전사완료", summarizing: "요약중", completed: "완료", failed: "오류",
};

// ── 데모 데이터 ───────────────────────────────────────────────
const DEMO_MEETING = {
  meeting_id: "demo", title: "Q2 제품 로드맵 검토", meeting_type: "planning",
  meeting_date: new Date().toISOString(), status: "completed",
  progress_percent: 100, tags: ["product", "design"], privacy_level: "private",
};
const DEMO_SUMMARY = {
  abstract: "웹/PWA 우선 출시 방향을 확정하고 앱스토어 없이 빠르게 검증 가능한 흐름을 정리했습니다.",
  decisions: ["1차 출시는 웹/PWA로 진행", "SwiftUI 앱은 App Store 권한 확보 후 재검토"],
  action_items: ["실제 회의 샘플 20개로 품질 점검", "공유 링크 화면 polish"],
};
const DEMO_TRANSCRIPT = [
  { start_sec: 0,  end_sec: 8,  speaker: "Speaker 1", text: "앱스토어 출시 권한이 없으니 웹 기반으로 먼저 검증하는 것이 좋겠습니다." },
  { start_sec: 9,  end_sec: 18, speaker: "Speaker 2", text: "동의합니다. PWA 화면을 붙이면 바로 사용자 테스트가 가능합니다." },
];

// ── 유틸 ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d)) return v;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function formatSeconds(s) {
  const t = Math.floor(s || 0);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function meetingTypeLabel(t) { return MEETING_TYPE_LABELS[t] || t || "일반"; }

// ── API ────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.appKey) headers["X-App-Key"] = state.appKey;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) { const d = await res.text(); throw new Error(d || `${res.status}`); }
  return res.json();
}

// ── Auth ───────────────────────────────────────────────────────
async function checkAuth() {
  try {
    await api("/v1/meetings?q=__auth_check__");
    return true;
  } catch (e) {
    if (e.message.includes("401") || e.message.includes("Unauthorized")) return false;
    return true; // 다른 오류는 통과
  }
}

async function initAuth() {
  const ok = await checkAuth();
  if (ok) return;

  $("authGate").classList.remove("hidden");
  $("authSubmit").addEventListener("click", async () => {
    const key = $("authInput").value.trim();
    state.appKey = key;
    localStorage.setItem("app_key", key);
    const valid = await checkAuth();
    if (valid) {
      $("authGate").classList.add("hidden");
      boot();
    } else {
      $("authError").classList.remove("hidden");
      state.appKey = "";
      localStorage.removeItem("app_key");
    }
  });
  $("authInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("authSubmit").click(); });
  throw new Error("AUTH_REQUIRED");
}

// ── 위치 ──────────────────────────────────────────────────────
function haversineDistance(la1, lo1, la2, lo2) {
  const R = 6371000, φ1 = la1 * Math.PI / 180, φ2 = la2 * Math.PI / 180;
  const a = Math.sin((la2-la1)*Math.PI/360)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin((lo2-lo1)*Math.PI/360)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getStoredLocations() {
  try { return JSON.parse(localStorage.getItem(LOCATIONS_KEY) || "[]"); } catch { return []; }
}

function findNearbyLocation(lat, lng) {
  return getStoredLocations().find(l => haversineDistance(lat, lng, l.lat, l.lng) < MATCH_RADIUS_M);
}

function saveLocationToMemory(lat, lng, name) {
  const locs = getStoredLocations();
  const ex = locs.find(l => haversineDistance(lat, lng, l.lat, l.lng) < MATCH_RADIUS_M);
  if (ex) { ex.name = name; ex.count = (ex.count||0)+1; }
  else locs.push({ lat, lng, name, count: 1 });
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locs));
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`, { headers: {"User-Agent":"AutoWrite/1.0"} });
    const d = await r.json();
    const a = d.address || {};
    return a.amenity || a.building || a.road || a.neighbourhood || a.suburb || a.city_district || a.city || "알 수 없는 위치";
  } catch { return "위치 변환 실패"; }
}

function renderLocationDisplay(name, isKnown) {
  const el = $("locationDisplay");
  el.innerHTML = `${escapeHtml(name)} <button class="location-action-btn" id="locBtn">${isKnown ? "수정" : "저장"}</button>`;
  $("locBtn").addEventListener("click", () => {
    const n = prompt(isKnown ? "장소 이름 수정:" : "이 장소 이름 저장:", name);
    if (n?.trim()) {
      state.currentLocation = n.trim();
      saveLocationToMemory(state.currentLat, state.currentLng, n.trim());
      renderLocationDisplay(n.trim(), true);
    }
  });
}

async function detectLocation() {
  if (!navigator.geolocation) { $("locationDisplay").textContent = "위치 기능 미지원"; return; }
  $("locationDisplay").textContent = "확인 중...";
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 })
    );
    const { latitude: lat, longitude: lng } = pos.coords;
    state.currentLat = lat; state.currentLng = lng;
    const nearby = findNearbyLocation(lat, lng);
    if (nearby) { state.currentLocation = nearby.name; renderLocationDisplay(nearby.name, true); }
    else {
      const addr = await reverseGeocode(lat, lng);
      state.currentLocation = addr; renderLocationDisplay(addr, false);
    }
  } catch { $("locationDisplay").textContent = "권한 없음"; }
}

// ── 날짜/시간 ─────────────────────────────────────────────────
function updateDatetimeDisplay() {
  const now = new Date();
  state.meetingDate = now.toISOString();
  $("datetimeDisplay").textContent = new Intl.DateTimeFormat("ko-KR", {
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", weekday:"short",
  }).format(now);
}

// ── 서버 상태 ─────────────────────────────────────────────────
async function checkHealth() {
  try {
    await fetch("/health");
    state.demoMode = false;
    $("serverStatus").textContent = "서버 연결됨";
  } catch {
    state.demoMode = true;
    $("serverStatus").textContent = "데모 모드";
  }
}

// ── 통계 ──────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api("/v1/stats");
    $("statTotal").textContent     = s.total;
    $("statCompleted").textContent = s.completed;
    $("statThisWeek").textContent  = s.this_week;
    $("statFailed").textContent    = s.failed;
    const byType = $("statsByType");
    byType.innerHTML = s.by_type.map(t =>
      `<span class="stat-type-pill">${meetingTypeLabel(t.meeting_type)} ${t.count}</span>`
    ).join("");
  } catch { /* demo mode */ }
}

// ── 회의 목록 ─────────────────────────────────────────────────
async function loadMeetings() {
  const params = new URLSearchParams();
  const q    = $("searchInput").value.trim();
  const type = $("filterType").value;
  if (q)    params.set("q", q);
  if (type) params.set("meeting_type", type);

  try {
    const data = await api(`/v1/meetings${params.toString() ? `?${params}` : ""}`);
    state.demoMode = false;
    state.meetings = data.meetings;
  } catch {
    state.demoMode = true;
    state.meetings = [DEMO_MEETING];
  }
  renderMeetings();

  if (state.selectedMeetingId) {
    const sel = state.meetings.find(m => m.meeting_id === state.selectedMeetingId);
    if (sel) renderDetail(sel);
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

  state.meetings.forEach(m => {
    const el = document.createElement("button");
    const active = m.meeting_id === state.selectedMeetingId;
    const done   = m.status === "completed";
    const failed = m.status === "failed";
    el.className = `meeting-item ${active ? "active" : ""}`;
    el.type = "button";
    el.innerHTML = `
      <div class="meeting-topline">
        <span class="meeting-title">${escapeHtml(m.title)}</span>
        <span class="pill ${done?"done":failed?"error":""}">${STATUS_LABEL[m.status]||m.status}</span>
      </div>
      <div class="meeting-meta">${formatDate(m.meeting_date)} · ${meetingTypeLabel(m.meeting_type)}</div>
      ${failed ? `<div class="error-hint">⚠️ ${escapeHtml(m.last_error||"처리 실패")} <button class="retry-btn" data-id="${m.meeting_id}">재시도</button></div>` : ""}
      ${!done && !failed ? `<progress value="${m.progress_percent||0}" max="100"></progress>` : ""}
      <div class="tag-row">${(m.tags||[]).slice(0,4).map(t=>`<span>#${escapeHtml(t)}</span>`).join("")}</div>
    `;
    el.addEventListener("click", e => {
      if (e.target.classList.contains("retry-btn")) {
        e.stopPropagation();
        retryMeeting(e.target.dataset.id);
      } else {
        selectMeeting(m.meeting_id);
      }
    });
    list.appendChild(el);
  });
}

async function selectMeeting(id) {
  state.selectedMeetingId = id;
  const m = state.meetings.find(m => m.meeting_id === id) || await api(`/v1/meetings/${id}`);
  state.selectedMeeting = m;
  renderMeetings();
  await renderDetail(m);
}

async function renderDetail(meeting) {
  $("emptyDetail").classList.add("hidden");
  $("meetingDetail").classList.remove("hidden");
  $("detailTitle").textContent = meeting.title;
  $("detailMeta").textContent  = `${formatDate(meeting.meeting_date)} · ${meetingTypeLabel(meeting.meeting_type)} · ${STATUS_LABEL[meeting.status]||meeting.status}`;
  $("markdownLink").href = `/v1/meetings/${meeting.meeting_id}/export/markdown`;
  $("pdfLink").href      = `/v1/meetings/${meeting.meeting_id}/export/pdf`;
  $("shareResult").classList.add("hidden");
  $("shareButton").onclick   = () => createShareLink(meeting.meeting_id);
  $("calendarButton").onclick = () => openCalendar(meeting);

  // 제목 인라인 편집
  $("detailTitle").onclick = () => {
    const cur = $("detailTitle").textContent;
    const input = document.createElement("input");
    input.value = cur;
    input.className = "title-inline-edit";
    $("detailTitle").replaceWith(input);
    input.focus();
    const save = async () => {
      const newTitle = input.value.trim() || cur;
      try { await api(`/v1/meetings/${meeting.meeting_id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({title:newTitle}) }); }
      catch {}
      const h2 = document.createElement("h2");
      h2.id = "detailTitle"; h2.style.cssText = "margin-bottom:0;cursor:pointer;";
      h2.textContent = newTitle; h2.title = "클릭하여 편집";
      input.replaceWith(h2);
      h2.onclick = () => $("detailTitle").click();
      meeting.title = newTitle;
    };
    input.addEventListener("blur", save);
    input.addEventListener("keydown", e => { if(e.key==="Enter") save(); if(e.key==="Escape") { input.value=cur; save(); } });
  };

  if (state.demoMode) {
    state.selectedSummary = DEMO_SUMMARY;
    renderSummaryView(DEMO_SUMMARY);
    renderList($("decisionsList"), DEMO_SUMMARY.decisions);
    renderList($("actionsList"),   DEMO_SUMMARY.action_items);
    renderTranscript(DEMO_TRANSCRIPT);
    return;
  }
  try {
    const [summary, transcript] = await Promise.all([
      api(`/v1/meetings/${meeting.meeting_id}/summary`),
      api(`/v1/meetings/${meeting.meeting_id}/transcript`),
    ]);
    state.selectedSummary = summary;
    renderSummaryView(summary);
    renderList($("decisionsList"), summary.decisions);
    renderList($("actionsList"),   summary.action_items);
    renderTranscript(transcript.segments || []);
  } catch {
    $("summaryText").textContent = "아직 분석이 완료되지 않았습니다.";
    renderList($("decisionsList"), []);
    renderList($("actionsList"),   []);
    renderTranscript([]);
  }
}

function renderSummaryView(summary) {
  $("summaryText").textContent = summary.abstract || "";
  $("summaryEdit").value = summary.abstract || "";
}

function renderList(el, items) {
  el.innerHTML = "";
  if (!items?.length) { el.innerHTML = "<li>항목 없음</li>"; return; }
  items.forEach(item => { const li = document.createElement("li"); li.textContent = item; el.appendChild(li); });
}

function renderTranscript(segments) {
  const list = $("transcriptList");
  list.innerHTML = "";
  if (!segments.length) {
    list.innerHTML = `<div class="segment"><p class="meeting-meta">전사 내용이 없습니다.</p></div>`;
    return;
  }
  segments.forEach(seg => {
    const div = document.createElement("div");
    div.className = "segment";
    div.innerHTML = `<div class="segment-time">${formatSeconds(seg.start_sec)} – ${formatSeconds(seg.end_sec)} · ${escapeHtml(seg.speaker||"Speaker")}</div><p>${escapeHtml(seg.text)}</p>`;
    list.appendChild(div);
  });
}

// ── 인라인 편집 — 요약 ────────────────────────────────────────
function bindSummaryEdit() {
  $("editSummaryBtn").addEventListener("click", () => {
    const editing = !$("summaryEdit").classList.contains("hidden");
    if (editing) {
      $("summaryEdit").classList.add("hidden");
      $("saveSummaryBtn").classList.add("hidden");
      $("summaryText").classList.remove("hidden");
      $("editSummaryBtn").textContent = "편집";
    } else {
      $("summaryEdit").value = $("summaryText").textContent;
      $("summaryEdit").classList.remove("hidden");
      $("saveSummaryBtn").classList.remove("hidden");
      $("summaryText").classList.add("hidden");
      $("editSummaryBtn").textContent = "취소";
    }
  });

  $("saveSummaryBtn").addEventListener("click", async () => {
    if (!state.selectedMeetingId) return;
    const newAbstract = $("summaryEdit").value.trim();
    try {
      await api(`/v1/meetings/${state.selectedMeetingId}/summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abstract: newAbstract }),
      });
      $("summaryText").textContent = newAbstract;
    } catch {}
    $("summaryEdit").classList.add("hidden");
    $("saveSummaryBtn").classList.add("hidden");
    $("summaryText").classList.remove("hidden");
    $("editSummaryBtn").textContent = "편집";
  });
}

// ── 재시도 ────────────────────────────────────────────────────
async function retryMeeting(meetingId) {
  try {
    await api(`/v1/meetings/${meetingId}/retry`, { method: "POST" });
    await loadMeetings();
    startPolling();
  } catch (e) {
    alert(`재시도 실패: ${e.message}`);
  }
}

// ── 캘린더 ────────────────────────────────────────────────────
function openCalendar(meeting) {
  const start = new Date(meeting.meeting_date);
  const end   = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt   = d => d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const abstract = state.selectedSummary?.abstract || "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text:   meeting.title,
    dates:  `${fmt(start)}/${fmt(end)}`,
    details: abstract,
  });
  window.open(`https://www.google.com/calendar/render?${params}`, "_blank");
}

// ── 공유 링크 ─────────────────────────────────────────────────
async function createShareLink(meetingId) {
  if (state.demoMode) {
    $("shareResult").textContent = "데모 모드에서는 공유 링크를 생성할 수 없습니다.";
    $("shareResult").classList.remove("hidden"); return;
  }
  try {
    const r = await api(`/v1/meetings/${meetingId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: "viewer", expires_in_days: 7 }),
    });
    const url = `${location.origin}${r.share_url}/markdown`;
    $("shareResult").innerHTML = `공유 링크: <a href="${url}" target="_blank">${url}</a>`;
  } catch {
    $("shareResult").textContent = "공유 링크 생성 실패.";
  }
  $("shareResult").classList.remove("hidden");
}

// ── 업로드 ────────────────────────────────────────────────────
function buildPlaceholderTitle() {
  const type = meetingTypeLabel($("meetingType").value);
  const loc  = state.currentLocation ? ` · ${state.currentLocation}` : "";
  const now  = new Date();
  return `${type} 회의${loc} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
}

async function uploadFile(file) {
  if (state.demoMode) { alert("데모 모드입니다. 백엔드 서버 연결 후 사용 가능합니다."); return; }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    alert(`파일이 ${MAX_FILE_MB}MB를 초과합니다. Groq API 제한으로 더 작은 파일을 사용해 주세요.`);
    return;
  }
  updateDatetimeDisplay();
  const title    = $("meetingTitle").value.trim() || buildPlaceholderTitle();
  const template = $("meetingTemplate").value;

  const form = new FormData();
  form.append("title",        title);
  form.append("meeting_type", $("meetingType").value || "general");
  form.append("meeting_date", state.meetingDate);
  form.append("template",     template);
  form.append("file",         file, file.name || "recording.webm");

  $("uploadButton").disabled = true;
  try {
    const r = await api("/v1/meetings/upload-file", { method: "POST", body: form });
    state.selectedMeetingId = r.meeting_id;
    if (state.currentLat && state.currentLocation) {
      saveLocationToMemory(state.currentLat, state.currentLng, state.currentLocation);
    }
    await loadMeetings();
    startPolling();
  } catch (e) {
    alert(`업로드 실패: ${e.message}`);
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
function getSupportedMimeType() {
  const types = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

function startRecordTimer() {
  state.recordStartTime = Date.now();
  $("recordTimer").classList.remove("hidden");
  state.recordTimerInterval = setInterval(() => {
    $("recordTimer").textContent = formatSeconds(Math.floor((Date.now()-state.recordStartTime)/1000));
  }, 1000);
}

function stopRecordTimer() {
  clearInterval(state.recordTimerInterval);
  $("recordTimer").classList.add("hidden");
}

async function toggleRecording() {
  if (state.mediaRecorder?.state === "recording") { state.mediaRecorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("이 브라우저에서는 녹음을 지원하지 않습니다."); return;
  }
  updateDatetimeDisplay();
  detectLocation(); // 비동기

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = [];
  const mimeType = getSupportedMimeType();
  state.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  state.mediaRecorder.addEventListener("dataavailable", e => { if(e.data.size>0) state.recordedChunks.push(e.data); });
  state.mediaRecorder.addEventListener("stop", async () => {
    stream.getTracks().forEach(t => t.stop());
    stopRecordTimer();
    $("recordButton").classList.remove("recording");
    $("recordLabel").textContent = "회의 녹음 시작";
    const ext  = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
    const blob = new Blob(state.recordedChunks, { type: mimeType || "audio/webm" });
    await uploadFile(new File([blob], `meeting-${Date.now()}.${ext}`, { type: mimeType || "audio/webm" }));
  });

  state.mediaRecorder.start();
  $("recordButton").classList.add("recording");
  $("recordLabel").textContent = "녹음 중지 & 분석";
  startRecordTimer();
}

// ── 폴링 (지수 백오프) ────────────────────────────────────────
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollInterval = 3000;
  const tick = async () => {
    await loadMeetings();
    const hasRunning = state.meetings.some(m => !["completed","failed"].includes(m.status));
    if (!hasRunning) {
      clearInterval(state.pollTimer);
      if (Notification.permission === "granted") {
        new Notification("Auto Write", { body: "✅ 회의록 분석 완료", icon: "/icon.svg" });
      }
      return;
    }
    if (state.pollInterval < 15000) {
      clearInterval(state.pollTimer);
      state.pollInterval = Math.min(state.pollInterval * 1.6, 15000);
      state.pollTimer = setInterval(tick, state.pollInterval);
    }
  };
  state.pollTimer = setInterval(tick, state.pollInterval);
}

// ── Siri 단축어 URL 처리 ─────────────────────────────────────
function handleUrlActions() {
  const params = new URLSearchParams(location.search);
  if (params.get("action") === "record") {
    setTimeout(() => $("recordButton").click(), 800);
  }
}

// ── 이벤트 ────────────────────────────────────────────────────
function bindEvents() {
  $("refreshButton").addEventListener("click", loadMeetings);
  $("filterButton").addEventListener("click", loadMeetings);
  $("uploadButton").addEventListener("click", handleUploadClick);
  $("recordButton").addEventListener("click", toggleRecording);
  $("searchInput").addEventListener("keydown", e => { if(e.key==="Enter") loadMeetings(); });
  $("statsToggle").addEventListener("click", async () => {
    const panel = $("statsPanel");
    const hidden = panel.classList.toggle("hidden");
    if (!hidden) await loadStats();
  });
  bindSummaryEdit();
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ── 부팅 ──────────────────────────────────────────────────────
async function boot() {
  try { await initAuth(); } catch(e) { if(e.message==="AUTH_REQUIRED") return; }
  bindEvents();
  updateDatetimeDisplay();
  detectLocation();
  handleUrlActions();
  await checkHealth();
  await loadMeetings();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
}

boot().catch(e => { console.error(e); $("serverStatus").textContent = "초기화 실패"; });

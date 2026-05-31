const state = {
  meetings: [],
  selectedMeetingId: null,
  mediaRecorder: null,
  recordedChunks: [],
  pollTimer: null,
  demoMode: false,
};

const demoMeeting = {
  meeting_id: "demo-meeting",
  title: "제품 로드맵 회의",
  meeting_type: "planning",
  meeting_date: new Date().toISOString(),
  status: "completed",
  progress_percent: 100,
  tags: ["product", "design", "engineering"],
  privacy_level: "private",
};

const demoSummary = {
  abstract: "이번 회의에서는 웹/PWA 우선 출시 방향을 확정하고, 앱스토어 없이 빠르게 검증 가능한 제품 흐름을 정리했습니다. 다음 단계는 실제 회의 샘플로 전사/요약 품질을 측정하고 공유 문서 템플릿을 다듬는 것입니다.",
  decisions: ["1차 출시는 웹/PWA로 진행", "SwiftUI 앱은 App Store 권한 확보 후 재검토", "공유 문서는 Markdown/PDF와 링크 공유를 기본으로 사용"],
  action_items: ["실제 회의 샘플 20개로 품질 점검", "iPhone Safari 녹음 제약 확인", "공유 링크 화면 polish"],
};

const demoTranscript = [
  { start_sec: 0, end_sec: 8, speaker: "Speaker 1", text: "앱스토어 출시 권한이 없으니 웹 기반으로 먼저 검증하는 것이 좋겠습니다." },
  { start_sec: 9, end_sec: 18, speaker: "Speaker 2", text: "동의합니다. 백엔드는 그대로 쓰고 PWA 화면을 붙이면 바로 사용자 테스트가 가능합니다." },
  { start_sec: 19, end_sec: 29, speaker: "Speaker 1", text: "결정사항과 할 일은 공유용 문서에서 한눈에 보이도록 정리해 주세요." },
];

const $ = (id) => document.getElementById(id);

const statusLabel = {
  queued: "THINKING",
  processing: "PROCESSING",
  transcribing: "READING",
  transcribed: "READ",
  summarizing: "EDITING",
  completed: "DONE",
  failed: "ERROR",
};

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function meetingTypeLabel(type) {
  const labels = {
    general: "일반",
    standup: "스탠드업",
    planning: "기획",
    review: "리뷰",
    sales: "영업",
  };
  return labels[type] || type || "일반";
}

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
    const selected = state.meetings.find((meeting) => meeting.meeting_id === state.selectedMeetingId);
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
    item.className = `meeting-item ${meeting.meeting_id === state.selectedMeetingId ? "active" : ""}`;
    item.type = "button";
    item.innerHTML = `
      <div class="meeting-topline">
        <span class="meeting-title">${escapeHtml(meeting.title)}</span>
        <span class="pill">${statusLabel[meeting.status] || meeting.status}</span>
      </div>
      <div class="meeting-meta">${formatDate(meeting.meeting_date)} · ${meetingTypeLabel(meeting.meeting_type)} · ${meeting.privacy_level}</div>
      ${meeting.status !== "completed" ? `<progress value="${meeting.progress_percent || 0}" max="100"></progress>` : ""}
      <div class="tag-row">${(meeting.tags || []).slice(0, 5).map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
    `;
    item.addEventListener("click", () => selectMeeting(meeting.meeting_id));
    list.appendChild(item);
  });
}

async function selectMeeting(meetingId) {
  state.selectedMeetingId = meetingId;
  const meeting = state.meetings.find((item) => item.meeting_id === meetingId) || await api(`/v1/meetings/${meetingId}`);
  renderMeetings();
  await renderDetail(meeting);
}

async function renderDetail(meeting) {
  $("emptyDetail").classList.add("hidden");
  $("meetingDetail").classList.remove("hidden");
  $("detailTitle").textContent = meeting.title;
  $("detailMeta").textContent = `${formatDate(meeting.meeting_date)} · ${meetingTypeLabel(meeting.meeting_type)} · ${statusLabel[meeting.status] || meeting.status}`;
  $("markdownLink").href = `/v1/meetings/${meeting.meeting_id}/export/markdown`;
  $("pdfLink").href = `/v1/meetings/${meeting.meeting_id}/export/pdf`;
  $("shareResult").classList.add("hidden");
  $("shareButton").onclick = () => createShareLink(meeting.meeting_id);

  try {
    if (state.demoMode) {
      $("summaryText").textContent = demoSummary.abstract;
      renderList($("decisionsList"), demoSummary.decisions);
      renderList($("actionsList"), demoSummary.action_items);
      renderTranscript(demoTranscript);
      return;
    }
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
  segments.forEach((segment) => {
    const div = document.createElement("div");
    div.className = "segment";
    div.innerHTML = `
      <div class="segment-time">${formatSeconds(segment.start_sec)} - ${formatSeconds(segment.end_sec)} · ${escapeHtml(segment.speaker || "Speaker")}</div>
      <div>${escapeHtml(segment.text)}</div>
    `;
    list.appendChild(div);
  });
}

function formatSeconds(seconds) {
  const total = Math.floor(seconds || 0);
  const min = String(Math.floor(total / 60)).padStart(2, "0");
  const sec = String(total % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

async function uploadFile(file) {
  if (state.demoMode) {
    alert("현재는 데모 모드입니다. 백엔드 서버가 켜지면 실제 업로드가 가능합니다.");
    return;
  }
  const title = $("meetingTitle").value.trim() || file.name.replace(/\.[^.]+$/, "") || "새 회의";
  const form = new FormData();
  form.append("title", title);
  form.append("meeting_type", $("meetingType").value || "general");
  form.append("meeting_date", new Date().toISOString());
  form.append("file", file, file.name || "recording.webm");

  $("uploadButton").disabled = true;
  try {
    const result = await api("/v1/meetings/upload-file", {
      method: "POST",
      body: form,
    });
    state.selectedMeetingId = result.meeting_id;
    await loadMeetings();
    startPolling();
  } finally {
    $("uploadButton").disabled = false;
  }
}

async function handleUploadClick() {
  const file = $("audioFile").files[0];
  if (!file) {
    alert("업로드할 음성 파일을 선택해 주세요.");
    return;
  }
  await uploadFile(file);
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

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = [];
  state.mediaRecorder = new MediaRecorder(stream);
  state.mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.recordedChunks.push(event.data);
  });
  state.mediaRecorder.addEventListener("stop", async () => {
    stream.getTracks().forEach((track) => track.stop());
    $("recordButton").textContent = "브라우저 녹음 시작";
    $("recordButton").classList.remove("recording");
    const blob = new Blob(state.recordedChunks, { type: "audio/webm" });
    const file = new File([blob], `meeting-${Date.now()}.webm`, { type: "audio/webm" });
    await uploadFile(file);
  });
  state.mediaRecorder.start();
  $("recordButton").textContent = "녹음 중지 & 분석";
  $("recordButton").classList.add("recording");
}

async function createShareLink(meetingId) {
  if (state.demoMode || location.port === "8001") {
    $("shareResult").innerHTML = "데모 모드에서는 실제 공유 링크를 만들지 않습니다. 백엔드 서버 연결 후 사용할 수 있습니다.";
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
    $("shareResult").innerHTML = `공유 링크가 생성되었습니다: <a href="${absolute}" target="_blank">${absolute}</a>`;
  } catch (error) {
    $("shareResult").textContent = "공유 링크 생성에 실패했습니다. 백엔드 서버 연결을 확인해 주세요.";
  }
  $("shareResult").classList.remove("hidden");
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    await loadMeetings();
    const hasRunning = state.meetings.some((meeting) => !["completed", "failed"].includes(meeting.status));
    if (!hasRunning) clearInterval(state.pollTimer);
  }, 1800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  $("refreshButton").addEventListener("click", loadMeetings);
  $("filterButton").addEventListener("click", loadMeetings);
  $("uploadButton").addEventListener("click", handleUploadClick);
  $("recordButton").addEventListener("click", toggleRecording);
  $("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadMeetings();
  });
}

async function boot() {
  bindEvents();
  await checkHealth();
  await loadMeetings();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

boot().catch((error) => {
  console.error(error);
  $("serverStatus").textContent = "초기화 실패";
});

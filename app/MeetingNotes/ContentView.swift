import SwiftUI

struct ContentView: View {
    @StateObject private var recorder = AudioRecorder()
    @StateObject private var apiService = ApiService()
    @State private var meetings: [Meeting] = []
    @State private var isShowingUploadAlert = false
    @State private var meetingTitle = ""
    @State private var pulseRecording = false
    @State private var searchText = ""
    @State private var selectedType = ""
    
    var body: some View {
        NavigationView {
            ZStack {
                CursorAsset.Color.canvas.ignoresSafeArea()
                
                VStack(spacing: 0) {
                    HStack {
                        Text("Auto Write")
                            .font(CursorAsset.Typography.displaySm())
                            .foregroundColor(CursorAsset.Color.ink)
                            .tracking(-0.11)
                        Spacer()
                    }
                    .padding(.horizontal, CursorAsset.Spacing.lg)
                    .padding(.vertical, CursorAsset.Spacing.base)

                    filterBar
                    
                    if meetings.isEmpty {
                        emptyStateView
                    } else {
                        meetingListView
                    }
                    
                    recordingBar
                }
            }
            .alert("회의 저장", isPresented: $isShowingUploadAlert) {
                TextField("회의 제목", text: $meetingTitle)
                Button("저장 및 분석") {
                    uploadRecording()
                }
                Button("취소", role: .cancel) { }
            } message: {
                Text("회의 제목을 입력해 주세요.")
            }
            .task {
                await refreshMeetings()
            }
        }
    }

    private var filterBar: some View {
        VStack(spacing: CursorAsset.Spacing.sm) {
            HStack(spacing: CursorAsset.Spacing.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(CursorAsset.Color.muted)
                TextField("회의 제목, 파일명 검색", text: $searchText)
                    .font(CursorAsset.Typography.bodySm())
                    .textFieldStyle(.plain)
                Button("검색") {
                    Task { await refreshMeetings() }
                }
                .font(CursorAsset.Typography.button())
                .foregroundColor(CursorAsset.Color.primary)
            }
            .padding(CursorAsset.Spacing.sm)
            .background(CursorAsset.Color.canvasSoft)
            .cornerRadius(CursorAsset.Radius.md)

            HStack(spacing: CursorAsset.Spacing.xs) {
                filterChip(title: "전체", value: "")
                filterChip(title: "일반", value: "general")
                filterChip(title: "리뷰", value: "review")
                filterChip(title: "기획", value: "planning")
                Spacer()
            }
        }
        .padding(.horizontal, CursorAsset.Spacing.lg)
        .padding(.bottom, CursorAsset.Spacing.base)
    }

    private func filterChip(title: String, value: String) -> some View {
        Button(action: {
            selectedType = value
            Task { await refreshMeetings() }
        }) {
            Text(title)
                .font(CursorAsset.Typography.caption())
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(selectedType == value ? CursorAsset.Color.primary.opacity(0.15) : CursorAsset.Color.surfaceCard)
                .foregroundColor(selectedType == value ? CursorAsset.Color.primary : CursorAsset.Color.body)
                .cornerRadius(CursorAsset.Radius.pill)
        }
        .buttonStyle(.plain)
    }
    
    private var emptyStateView: some View {
        VStack(spacing: CursorAsset.Spacing.lg) {
            Spacer()
            Image(systemName: "mic")
                .font(.system(size: 48, weight: .light))
                .foregroundColor(CursorAsset.Color.muted)
            
            VStack(spacing: CursorAsset.Spacing.xs) {
                Text("새로운 회의를 시작해보세요")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(CursorAsset.Color.ink)
                
                Text("하단 버튼을 눌러 녹음을 시작할 수 있습니다.")
                    .font(.system(size: 14))
                    .foregroundColor(CursorAsset.Color.body)
                    .multilineTextAlignment(.center)
            }
            Spacer()
        }
        .padding(CursorAsset.Spacing.section)
    }
    
    private var meetingListView: some View {
        ScrollView {
            LazyVStack(spacing: CursorAsset.Spacing.base) {
                ForEach(meetings) { meeting in
                    NavigationLink(destination: MeetingDetailView(meeting: meeting)) {
                        MeetingCard(meeting: meeting)
                    }
                    .buttonStyle(PlainButtonStyle())
                }
            }
            .padding(CursorAsset.Spacing.lg)
        }
    }
    
    private var recordingBar: some View {
        VStack {
            Divider().background(CursorAsset.Color.hairline)
            
            Button(action: {
                if recorder.isRecording {
                    recorder.stopRecording()
                    isShowingUploadAlert = true
                } else {
                    recorder.startRecording()
                    pulseRecording = true
                }
            }) {
                HStack(spacing: CursorAsset.Spacing.sm) {
                    Circle()
                        .fill(recorder.isRecording ? CursorAsset.Color.primaryActive : CursorAsset.Color.primary)
                        .frame(width: 12, height: 12)
                        .scaleEffect(recorder.isRecording && pulseRecording ? 1.4 : 1)
                        .opacity(recorder.isRecording && pulseRecording ? 0.55 : 1)
                        .animation(recorder.isRecording ? CursorAsset.Motion.pulse : CursorAsset.Motion.quick, value: pulseRecording)
                    
                    Text(recorder.isRecording ? "녹음 중지" : "새 회의 녹음 시작")
                        .font(CursorAsset.Typography.button())
                }
                .foregroundColor(.white)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .background(recorder.isRecording ? CursorAsset.Color.primaryActive : CursorAsset.Color.primary)
                .cornerRadius(CursorAsset.Radius.md)
                .padding(CursorAsset.Spacing.lg)
            }
        }
        .background(CursorAsset.Color.canvas)
        .onChange(of: recorder.isRecording) { _, isRecording in
            pulseRecording = isRecording
        }
    }
    
    private func uploadRecording() {
        guard let url = recorder.lastRecordingURL else { return }
        let title = meetingTitle.isEmpty ? "새로운 회의" : meetingTitle
        
        Task {
            do {
                let response = try await apiService.uploadAudio(fileURL: url, title: title)
                DispatchQueue.main.async {
                    let newMeeting = Meeting(
                        id: response.meeting_id,
                        title: title,
                        date: Date(),
                        type: "general",
                        status: response.status
                    )
                    meetings.insert(newMeeting, at: 0)
                    meetingTitle = ""
                }
                await pollMeetingStatus(meetingId: response.meeting_id)
            } catch {
                print("업로드 에러: \(error)")
            }
        }
    }

    private func pollMeetingStatus(meetingId: String) async {
        for _ in 0..<60 {
            do {
                let status = try await apiService.fetchMeetingStatus(meetingId: meetingId)
                DispatchQueue.main.async {
                    if let index = meetings.firstIndex(where: { $0.id == meetingId }) {
                        meetings[index].status = status.status
                        meetings[index].progressPercent = status.progress_percent
                    }
                }
                if status.status == "completed" || status.status == "failed" {
                    return
                }
            } catch { }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
    }

    private func refreshMeetings() async {
        do {
            let fetched = try await apiService.fetchMeetings(
                query: searchText,
                meetingType: selectedType,
                tag: nil
            )
            DispatchQueue.main.async {
                withAnimation(CursorAsset.Motion.smooth) {
                    self.meetings = fetched
                }
            }
        } catch {
            print("목록 조회 에러: \(error)")
        }
    }
}

struct MeetingCard: View {
    let meeting: Meeting
    
    var body: some View {
        VStack(alignment: .leading, spacing: CursorAsset.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(meeting.title)
                        .font(CursorAsset.Typography.titleMd())
                        .foregroundColor(CursorAsset.Color.ink)
                    
                    HStack(spacing: 8) {
                        Text(meeting.date, style: .date)
                        Text("•")
                        Text(meeting.type.uppercased())
                    }
                    .font(.system(size: 13))
                    .foregroundColor(CursorAsset.Color.muted)
                }
                
                Spacer()
                
                if meeting.status != "completed" {
                    statusPill
                }
            }

            if meeting.status != "completed" {
                ProgressView(value: Double(meeting.progressPercent), total: 100)
                    .tint(statusColor)
            }

            if !meeting.tags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(meeting.tags.prefix(4), id: \.self) { tag in
                        Text("#\(tag)")
                            .font(CursorAsset.Typography.caption())
                            .foregroundColor(CursorAsset.Color.muted)
                    }
                }
            }
        }
        .cardSurface()
        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
        .animation(CursorAsset.Motion.smooth, value: meeting.status)
    }
    
    private var statusPill: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(statusText)
                .font(CursorAsset.Typography.captionUpper())
                .tracking(0.88)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(statusColor.opacity(0.15))
        .foregroundColor(CursorAsset.Color.ink)
        .cornerRadius(CursorAsset.Radius.pill)
    }
    
    private var statusText: String {
        switch meeting.status {
        case "queued": return "THINKING"
        case "transcribing": return "READING"
        case "summarizing": return "EDITING"
        case "failed": return "ERROR"
        default: return "DONE"
        }
    }
    
    private var statusColor: Color {
        switch meeting.status {
        case "queued": return CursorAsset.Color.thinking
        case "transcribing": return CursorAsset.Color.read
        case "summarizing": return CursorAsset.Color.edit
        case "failed": return CursorAsset.Color.error
        default: return CursorAsset.Color.done
        }
    }
}

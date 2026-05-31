import SwiftUI

struct MeetingDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let meeting: Meeting
    @StateObject private var apiService = ApiService()
    @State private var summary: MeetingSummary?
    @State private var segments: [TranscriptSegment] = []
    @State private var isLoading = true
    @State private var selectedTab = 0
    @State private var shareURLText: String?
    
    var body: some View {
        ZStack {
            CursorAsset.Color.canvas.ignoresSafeArea()
            
            VStack(spacing: 0) {
                headerView
                exportActions
                
                tabSwitcher
                
                if isLoading {
                    loadingView
                } else {
                    contentView
                }
            }
        }
        .onAppear {
            fetchData()
        }
    }
    
    private var headerView: some View {
        VStack(alignment: .leading, spacing: CursorAsset.Spacing.xs) {
            HStack {
                Button(action: { dismiss() }) {
                    Image(systemName: "chevron.left")
                        .foregroundColor(CursorAsset.Color.ink)
                }
                Spacer()
                Text(meeting.date, style: .date)
                    .font(CursorAsset.Typography.caption())
                    .foregroundColor(CursorAsset.Color.muted)
            }
            .padding(.bottom, CursorAsset.Spacing.sm)
            
            Text(meeting.title)
                .font(CursorAsset.Typography.displaySm())
                .foregroundColor(CursorAsset.Color.ink)
                .tracking(-0.11)
        }
        .padding(CursorAsset.Spacing.lg)
        .background(CursorAsset.Color.canvas)
    }

    private var exportActions: some View {
        HStack(spacing: CursorAsset.Spacing.sm) {
            Button(action: createShareLink) {
                Label("공유 링크", systemImage: "link")
            }
            .buttonStyle(.borderedProminent)

            Link(destination: URL(string: "http://localhost:8000/v1/meetings/\(meeting.id)/export/markdown")!) {
                Label("Markdown", systemImage: "doc.text")
            }
            .buttonStyle(.bordered)

            Link(destination: URL(string: "http://localhost:8000/v1/meetings/\(meeting.id)/export/pdf")!) {
                Label("PDF", systemImage: "doc.richtext")
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .font(CursorAsset.Typography.button())
        .padding(.horizontal, CursorAsset.Spacing.lg)
        .padding(.bottom, CursorAsset.Spacing.base)
        .overlay(alignment: .bottomLeading) {
            if let shareURLText {
                Text(shareURLText)
                    .font(CursorAsset.Typography.caption())
                    .foregroundColor(CursorAsset.Color.success)
                    .padding(.horizontal, CursorAsset.Spacing.lg)
                    .offset(y: CursorAsset.Spacing.base)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
    
    private var tabSwitcher: some View {
        HStack(spacing: CursorAsset.Spacing.xl) {
            tabButton(title: "AI 요약", index: 0)
            tabButton(title: "전사 전문", index: 1)
            Spacer()
        }
        .padding(.horizontal, CursorAsset.Spacing.lg)
        .padding(.vertical, CursorAsset.Spacing.base)
        .background(CursorAsset.Color.canvas)
        .overlay(
            VStack {
                Spacer()
                Divider().background(CursorAsset.Color.hairline)
            }
        )
    }
    
    private func tabButton(title: String, index: Int) -> some View {
        Button(action: { selectedTab = index }) {
            VStack(spacing: 8) {
                Text(title)
                    .font(CursorAsset.Typography.navLink())
                    .foregroundColor(selectedTab == index ? CursorAsset.Color.ink : CursorAsset.Color.muted)
                
                Rectangle()
                    .fill(selectedTab == index ? CursorAsset.Color.primary : Color.clear)
                    .frame(height: 2)
            }
        }
    }
    
    private var loadingView: some View {
        VStack(spacing: CursorAsset.Spacing.base) {
            Spacer()
            ProgressView()
                .scaleEffect(1.5)
            Text("AI가 내용을 분석하고 있습니다...")
                .font(CursorAsset.Typography.bodySm())
                .foregroundColor(CursorAsset.Color.muted)
            Spacer()
        }
    }
    
    private var contentView: some View {
        ScrollView {
            VStack(spacing: CursorAsset.Spacing.lg) {
                if selectedTab == 0 {
                    summaryTab
                } else {
                    transcriptTab
                }
            }
            .padding(CursorAsset.Spacing.lg)
        }
    }
    
    private var summaryTab: some View {
        VStack(alignment: .leading, spacing: CursorAsset.Spacing.xl) {
            VStack(alignment: .leading, spacing: CursorAsset.Spacing.base) {
                Label("회의 요약", systemImage: "text.alignleft")
                    .font(CursorAsset.Typography.captionUpper())
                    .foregroundColor(CursorAsset.Color.muted)
                
                Text(summary?.abstract ?? "요약 정보가 없습니다.")
                    .font(CursorAsset.Typography.bodyMd())
                    .foregroundColor(CursorAsset.Color.ink)
                    .lineSpacing(6)
            }
            .cardSurface()
            
            VStack(alignment: .leading, spacing: CursorAsset.Spacing.base) {
                summarySection(title: "결정 사항", items: summary?.decisions ?? [], icon: "checkmark.circle", color: CursorAsset.Color.success)
                Divider().background(CursorAsset.Color.hairlineSoft)
                summarySection(title: "할 일 (Action Items)", items: summary?.action_items ?? [], icon: "list.bullet.circle", color: CursorAsset.Color.primary)
            }
            .cardSurface()
        }
    }
    
    private func summarySection(title: String, items: [String], icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: CursorAsset.Spacing.base) {
            Label(title, systemImage: icon)
                .font(CursorAsset.Typography.titleSm())
                .foregroundColor(color)
            
            if items.isEmpty {
                Text("추출된 항목이 없습니다.")
                    .font(CursorAsset.Typography.bodySm())
                    .foregroundColor(CursorAsset.Color.mutedSoft)
            } else {
                VStack(alignment: .leading, spacing: CursorAsset.Spacing.sm) {
                    ForEach(items, id: \.self) { item in
                        HStack(alignment: .top, spacing: CursorAsset.Spacing.xs) {
                            Text("•")
                            Text(item)
                                .font(CursorAsset.Typography.bodyMd())
                                .foregroundColor(CursorAsset.Color.ink)
                        }
                    }
                }
            }
        }
    }
    
    private var transcriptTab: some View {
        VStack(alignment: .leading, spacing: CursorAsset.Spacing.base) {
            ForEach(segments) { segment in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(segment.speaker ?? "참석자")
                            .font(CursorAsset.Typography.captionUpper())
                            .foregroundColor(CursorAsset.Color.muted)
                        Spacer()
                        Text(formatTime(segment.start_sec))
                            .font(CursorAsset.Typography.code())
                            .foregroundColor(CursorAsset.Color.mutedSoft)
                    }
                    
                    Text(segment.text)
                        .font(CursorAsset.Typography.bodyMd())
                        .foregroundColor(CursorAsset.Color.ink)
                        .padding(CursorAsset.Spacing.base)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(CursorAsset.Color.canvasSoft)
                        .cornerRadius(CursorAsset.Radius.md)
                }
            }
        }
    }
    
    private func fetchData() {
        Task {
            for attempt in 0..<30 {
                do {
                    let fetchedSegments = try await apiService.fetchTranscript(meetingId: meeting.id)
                    let fetchedSummary = try await apiService.fetchSummary(meetingId: meeting.id)
                    DispatchQueue.main.async {
                        self.summary = fetchedSummary
                        self.segments = fetchedSegments
                        self.isLoading = false
                    }
                    return
                } catch { }
                let delayNs = UInt64(min(10, 1 + attempt / 3)) * 1_000_000_000
                try? await Task.sleep(nanoseconds: delayNs)
            }
        }
    }
    
    private func formatTime(_ seconds: Double) -> String {
        let min = Int(seconds) / 60
        let sec = Int(seconds) % 60
        return String(format: "%02d:%02d", min, sec)
    }

    private func createShareLink() {
        Task {
            do {
                let response = try await apiService.createShareLink(meetingId: meeting.id)
                DispatchQueue.main.async {
                    withAnimation(CursorAsset.Motion.smooth) {
                        self.shareURLText = "공유 링크 생성됨: \(response.share_url)"
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    withAnimation(CursorAsset.Motion.smooth) {
                        self.shareURLText = "공유 링크 생성 실패"
                    }
                }
            }
        }
    }
}

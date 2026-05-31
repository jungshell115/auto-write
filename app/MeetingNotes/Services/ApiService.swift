import Foundation

struct UploadResponse: Codable {
    let meeting_id: String
    let job_id: String
    let status: String
}

struct MeetingStatus: Codable {
    let meeting_id: String
    let title: String
    let meeting_type: String
    let meeting_date: String
    let status: String
    let progress_percent: Int
    let participants: [String]
    let tags: [String]
    let privacy_level: String
}

struct MeetingListResponse: Codable {
    let meetings: [MeetingStatus]
}

struct MeetingSummary: Codable {
    let meeting_id: String
    let status: String
    let abstract: String
    let decisions: [String]
    let action_items: [String]
}

struct TranscriptSegment: Codable, Identifiable {
    var id: String { "\(start_sec)-\(end_sec)" }
    let speaker: String?
    let start_sec: Double
    let end_sec: Double
    let text: String
}

struct TranscriptResponse: Codable {
    let meeting_id: String
    let status: String
    let segments: [TranscriptSegment]
}

struct ShareLinkResponse: Codable {
    let token: String
    let meeting_id: String
    let permission: String
    let expires_at: String?
    let share_url: String
}

class ApiService: ObservableObject {
    private let baseURL = "http://localhost:8000"
    
    func uploadAudio(fileURL: URL, title: String) async throws -> UploadResponse {
        let url = URL(string: "\(baseURL)/v1/meetings/upload-file")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        
        let fileData = try Data(contentsOf: fileURL)
        var body = Data()
        
        let fields = [
            "title": title,
            "meeting_type": "general",
            "meeting_date": ISO8601DateFormatter().string(from: Date())
        ]
        
        for (key, value) in fields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        
        request.httpBody = body
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "ApiService", code: 0, userInfo: [NSLocalizedDescriptionKey: "업로드 실패"])
        }
        
        return try JSONDecoder().decode(UploadResponse.self, from: data)
    }

    func fetchMeetingStatus(meetingId: String) async throws -> MeetingStatus {
        let url = URL(string: "\(baseURL)/v1/meetings/\(meetingId)")!
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "ApiService", code: 0, userInfo: [NSLocalizedDescriptionKey: "상태 조회 실패"])
        }

        return try JSONDecoder().decode(MeetingStatus.self, from: data)
    }

    func fetchMeetings(query: String? = nil, meetingType: String? = nil, tag: String? = nil) async throws -> [Meeting] {
        var components = URLComponents(string: "\(baseURL)/v1/meetings")!
        var items: [URLQueryItem] = []
        if let query, !query.isEmpty {
            items.append(URLQueryItem(name: "q", value: query))
        }
        if let meetingType, !meetingType.isEmpty {
            items.append(URLQueryItem(name: "meeting_type", value: meetingType))
        }
        if let tag, !tag.isEmpty {
            items.append(URLQueryItem(name: "tag", value: tag))
        }
        components.queryItems = items.isEmpty ? nil : items
        let (data, response) = try await URLSession.shared.data(from: components.url!)

        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "ApiService", code: 0, userInfo: [NSLocalizedDescriptionKey: "목록 조회 실패"])
        }

        let result = try JSONDecoder().decode(MeetingListResponse.self, from: data)
        return result.meetings.map { $0.asMeeting() }
    }
    
    func fetchSummary(meetingId: String) async throws -> MeetingSummary {
        let url = URL(string: "\(baseURL)/v1/meetings/\(meetingId)/summary")!
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "ApiService", code: 0, userInfo: [NSLocalizedDescriptionKey: "요약 조회 실패"])
        }
        
        return try JSONDecoder().decode(MeetingSummary.self, from: data)
    }
    
    func fetchTranscript(meetingId: String) async throws -> [TranscriptSegment] {
        let url = URL(string: "\(baseURL)/v1/meetings/\(meetingId)/transcript")!
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "ApiService", code: 0, userInfo: [NSLocalizedDescriptionKey: "전사 조회 실패"])
        }
        
        let result = try JSONDecoder().decode(TranscriptResponse.self, from: data)
        return result.segments
    }

    func createShareLink(meetingId: String) async throws -> ShareLinkResponse {
        let url = URL(string: "\(baseURL)/v1/meetings/\(meetingId)/share")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = """
        {"permission":"viewer","expires_in_days":7}
        """.data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw NSError(domain: "ApiService", code: 0, userInfo: [NSLocalizedDescriptionKey: "공유 링크 생성 실패"])
        }
        return try JSONDecoder().decode(ShareLinkResponse.self, from: data)
    }
}

extension MeetingStatus {
    func asMeeting() -> Meeting {
        let dateOnlyFormatter = DateFormatter()
        dateOnlyFormatter.dateFormat = "yyyy-MM-dd"
        let parsedDate = ISO8601DateFormatter().date(from: meeting_date)
            ?? dateOnlyFormatter.date(from: meeting_date)
            ?? Date()
        return Meeting(
            id: meeting_id,
            title: title,
            date: parsedDate,
            type: meeting_type,
            status: status,
            progressPercent: progress_percent,
            participants: participants,
            tags: tags,
            privacyLevel: privacy_level
        )
    }
}

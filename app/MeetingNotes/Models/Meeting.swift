import Foundation

struct Meeting: Identifiable, Codable {
    let id: String
    let title: String
    let date: Date
    let type: String
    var status: String
    var progressPercent: Int
    var participants: [String]
    var tags: [String]
    var privacyLevel: String

    init(
        id: String,
        title: String,
        date: Date,
        type: String,
        status: String,
        progressPercent: Int = 0,
        participants: [String] = [],
        tags: [String] = [],
        privacyLevel: String = "private"
    ) {
        self.id = id
        self.title = title
        self.date = date
        self.type = type
        self.status = status
        self.progressPercent = progressPercent
        self.participants = participants
        self.tags = tags
        self.privacyLevel = privacyLevel
    }
}


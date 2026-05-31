import SwiftUI

enum CursorAsset {
    enum Color {
        static let primary = SwiftUI.Color(hex: "f54e00")
        static let primaryActive = SwiftUI.Color(hex: "d04200")
        static let ink = SwiftUI.Color(hex: "26251e")
        static let body = SwiftUI.Color(hex: "5a5852")
        static let bodyStrong = SwiftUI.Color(hex: "26251e")
        static let muted = SwiftUI.Color(hex: "807d72")
        static let mutedSoft = SwiftUI.Color(hex: "a09c92")
        static let hairline = SwiftUI.Color(hex: "e6e5e0")
        static let hairlineSoft = SwiftUI.Color(hex: "efeee8")
        static let hairlineStrong = SwiftUI.Color(hex: "cfcdc4")
        static let canvas = SwiftUI.Color(hex: "f7f7f4")
        static let canvasSoft = SwiftUI.Color(hex: "fafaf7")
        static let surfaceCard = SwiftUI.Color(hex: "ffffff")
        static let surfaceStrong = SwiftUI.Color(hex: "e6e5e0")
        
        static let thinking = SwiftUI.Color(hex: "dfa88f")
        static let grep = SwiftUI.Color(hex: "9fc9a2")
        static let read = SwiftUI.Color(hex: "9fbbe0")
        static let edit = SwiftUI.Color(hex: "c0a8dd")
        static let done = SwiftUI.Color(hex: "c08532")
        
        static let error = SwiftUI.Color(hex: "cf2d56")
        static let success = SwiftUI.Color(hex: "1f8a65")
    }
    
    enum Typography {
        static func displayMega() -> Font { .system(size: 72, weight: .regular) }
        static func displayLg() -> Font { .system(size: 36, weight: .regular) }
        static func displayMd() -> Font { .system(size: 26, weight: .regular) }
        static func displaySm() -> Font { .system(size: 22, weight: .regular) }
        static func titleMd() -> Font { .system(size: 18, weight: .semibold) }
        static func titleSm() -> Font { .system(size: 16, weight: .semibold) }
        static func bodyMd() -> Font { .system(size: 16, weight: .regular) }
        static func bodySm() -> Font { .system(size: 14, weight: .regular) }
        static func caption() -> Font { .system(size: 13, weight: .regular) }
        static func captionUpper() -> Font { .system(size: 11, weight: .semibold) }
        static func code() -> Font { .system(size: 13, weight: .regular, design: .monospaced) }
        static func navLink() -> Font { .system(size: 14, weight: .medium) }
        static func button() -> Font { .system(size: 14, weight: .medium) }
    }
    
    enum Spacing {
        static let section: CGFloat = 80
        static let xl: CGFloat = 32
        static let lg: CGFloat = 24
        static let base: CGFloat = 16
        static let sm: CGFloat = 12
        static let xs: CGFloat = 8
    }
    
    enum Radius {
        static let lg: CGFloat = 12
        static let md: CGFloat = 8
        static let sm: CGFloat = 6
        static let pill: CGFloat = 9999
    }

    enum Motion {
        static let quick = Animation.easeOut(duration: 0.18)
        static let smooth = Animation.spring(response: 0.38, dampingFraction: 0.86)
        static let pulse = Animation.easeInOut(duration: 0.9).repeatForever(autoreverses: true)
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

struct CardSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(CursorAsset.Spacing.base)
            .background(CursorAsset.Color.surfaceCard)
            .cornerRadius(CursorAsset.Radius.lg)
            .overlay(
                RoundedRectangle(cornerRadius: CursorAsset.Radius.lg)
                    .stroke(CursorAsset.Color.hairline, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.03), radius: 14, x: 0, y: 8)
    }
}

extension View {
    func cardSurface() -> some View {
        modifier(CardSurface())
    }
}

import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case search, downloads, settings

    var id: String { rawValue }
    var title: String {
        switch self {
        case .search: "搜索书籍"
        case .downloads: "下载任务"
        case .settings: "导出设置"
        }
    }
    var icon: String {
        switch self {
        case .search: "magnifyingglass"
        case .downloads: "arrow.down.circle"
        case .settings: "folder"
        }
    }
}

struct SearchResponse: Decodable {
    let books: [Book]
}

struct Book: Identifiable, Decodable, Hashable {
    let bookId: String
    let bookName: String
    let author: String
    let description: String
    let coverUrl: String
    let statusText: String
    let totalChapters: Int
    let wordCount: Int
    let rating: Double
    let readCntText: String
    let tags: [String]
    let searchTags: [String]

    var id: String { bookId }
}

struct DownloadTask: Identifiable, Decodable, Hashable {
    let id: String
    let bookId: String
    let bookName: String?
    let author: String?
    let format: String
    let status: String
    let progress: Int
    let completedChapters: Int
    let totalChapters: Int
    let outputPath: String?
    let error: String?
}

struct DeleteDownloadResult: Decodable {
    let deleted: Bool
}

struct ClearCompletedResult: Decodable {
    let deletedCount: Int
}

struct Settings: Decodable {
    let exportDirectory: String
    let exportFormat: String
    let searchHistory: [String]
}

struct DownloadStatus: Decodable {
    let tasks: [DownloadTask]
}

struct RuntimeStatus: Decodable {
    let downloads: DownloadStatus
    let settings: Settings
}

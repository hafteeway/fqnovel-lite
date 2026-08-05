import AppKit
import Combine
import SwiftUI

@MainActor
final class LibraryModel: ObservableObject {
    @Published var section: AppSection? = .search
    @Published var query = ""
    @Published private(set) var books: [Book] = []
    @Published private(set) var isSearching = false
    @Published var alert: AppAlert?

    let bridge = NativeCoreBridge()
    private var bridgeUpdates: AnyCancellable?
    private var directoryPanel: NSOpenPanel?

    init() {
        bridgeUpdates = bridge.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    var tasks: [DownloadTask] { bridge.status?.downloads.tasks ?? [] }
    var exportDirectory: String { bridge.status?.settings.exportDirectory ?? "正在读取…" }
    var exportFormat: String { bridge.status?.settings.exportFormat ?? "epub" }
    var searchHistory: [String] { bridge.status?.settings.searchHistory ?? [] }

    func start() {
        bridge.start()
        Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard bridge.isReady else { return }
            _ = try? await bridge.request("status", as: RuntimeStatus.self)
        }
    }

    func search() {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return }
        guard bridge.isReady else {
            alert = AppAlert(title: "下载工具仍在准备", message: "请稍候几秒再搜索；如果一直没有准备好，请根据页面提示重新构建下载核心。")
            return
        }
        isSearching = true
        Task {
            defer { isSearching = false }
            do {
                let result = try await bridge.request("search", payload: ["query": term], as: SearchResponse.self)
                books = result.books
            } catch { alert = AppAlert(title: "未能完成搜索", message: error.localizedDescription) }
        }
    }

    func createDownload(_ book: Book) {
        Task {
            do {
                _ = try await bridge.request("createDownload", payload: ["bookId": book.bookId, "format": exportFormat], as: DownloadTask.self)
                section = .downloads
            } catch { alert = AppAlert(title: "无法开始下载", message: error.localizedDescription) }
        }
    }

    func control(_ task: DownloadTask, action: String) {
        Task {
            do {
                _ = try await bridge.request("controlDownload", payload: ["taskId": task.id, "action": action], as: DownloadTask.self)
            } catch { alert = AppAlert(title: "下载操作未完成", message: error.localizedDescription) }
        }
    }

    func deleteHistory(_ task: DownloadTask) {
        Task {
            do {
                _ = try await bridge.request("deleteDownload", payload: ["taskId": task.id], as: DeleteDownloadResult.self)
            } catch { alert = AppAlert(title: "无法删除记录", message: error.localizedDescription) }
        }
    }

    func deleteCompletedHistory() {
        Task {
            do {
                _ = try await bridge.request("deleteCompletedDownloads", as: ClearCompletedResult.self)
            } catch { alert = AppAlert(title: "无法清除记录", message: error.localizedDescription) }
        }
    }

    func setExportFormat(_ format: String) {
        Task {
            do {
                _ = try await bridge.request("setExportFormat", payload: ["format": format], as: Settings.self)
            } catch { alert = AppAlert(title: "无法保存导出格式", message: error.localizedDescription) }
        }
    }

    func clearSearchHistory() {
        Task {
            do {
                _ = try await bridge.request("clearSearchHistory", as: Settings.self)
            } catch { alert = AppAlert(title: "无法清除搜索记录", message: error.localizedDescription) }
        }
    }

    func chooseExportDirectory() {
        let panel = NSOpenPanel()
        panel.title = "选择默认导出目录"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        guard let window = NSApp.keyWindow ?? NSApp.windows.first else {
            alert = AppAlert(title: "无法选择目录", message: "当前没有可用窗口，请关闭后重新打开应用再试。")
            return
        }
        directoryPanel = panel
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            defer { self.directoryPanel = nil }
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                do {
                    _ = try await self.bridge.request("setExportDirectory", payload: ["directory": url.path], as: Settings.self)
                } catch {
                    self.alert = AppAlert(title: "无法保存导出目录", message: error.localizedDescription)
                }
            }
        }
    }

    func reveal(_ task: DownloadTask) {
        guard let outputPath = task.outputPath else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: outputPath)])
    }
}

struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

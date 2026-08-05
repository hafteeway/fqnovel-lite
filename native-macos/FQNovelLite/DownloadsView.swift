import SwiftUI

struct DownloadsView: View {
    @EnvironmentObject private var model: LibraryModel
    @State private var deletionRequest: DeletionRequest?

    private var completedTasks: [DownloadTask] {
        model.tasks.filter { $0.status == "completed" }
    }

    var body: some View {
        Group {
            if model.tasks.isEmpty {
                ContentUnavailableView("还没有下载任务", systemImage: "arrow.down.circle", description: Text("搜索书籍后，选择 TXT 或 EPUB 开始下载。"))
            } else {
                List {
                    if !completedTasks.isEmpty {
                        Section {
                            HStack {
                                Text("已完成 \(completedTasks.count) 项").foregroundStyle(.secondary)
                                Spacer()
                                Button("清除已完成记录", role: .destructive) { deletionRequest = .all }
                                    .buttonStyle(.borderless)
                            }
                        }
                    }
                    ForEach(model.tasks) { task in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(task.bookName ?? task.bookId).font(.headline)
                                Text(task.author ?? "未知作者").foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(task.format.uppercased()) · \(statusName(task.status))")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        ProgressView(value: Double(task.progress), total: 100) {
                            Text("\(task.completedChapters)/\(task.totalChapters) 章")
                        } currentValueLabel: { Text("\(task.progress)%").monospacedDigit() }
                        if let error = task.error { Text(error).font(.caption).foregroundStyle(.red) }
                        HStack {
                            if task.status == "running" { Button("暂停") { model.control(task, action: "pause") } }
                            if ["paused", "failed"].contains(task.status) { Button(task.status == "failed" ? "重试" : "继续") { model.control(task, action: "resume") } }
                            if !["completed", "cancelled"].contains(task.status) { Button("取消", role: .destructive) { model.control(task, action: "cancel") } }
                            if task.status == "completed" {
                                if task.outputPath != nil { Button("在 Finder 中显示") { model.reveal(task) } }
                                Button("删除记录", role: .destructive) { deletionRequest = .one(task) }
                            }
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 8)
                }
                }
                .listStyle(.inset)
            }
        }
        .confirmationDialog(deletionRequest?.title ?? "", isPresented: Binding(
            get: { deletionRequest != nil },
            set: { if !$0 { deletionRequest = nil } }
        ), titleVisibility: .visible) {
            Button("删除记录", role: .destructive) {
                switch deletionRequest {
                case .one(let task): model.deleteHistory(task)
                case .all: model.deleteCompletedHistory()
                case nil: break
                }
                deletionRequest = nil
            }
            Button("取消", role: .cancel) { deletionRequest = nil }
        } message: {
            Text(deletionRequest?.message ?? "")
        }
    }

    private func statusName(_ value: String) -> String {
        ["queued": "等待中", "running": "下载中", "paused": "已暂停", "exporting": "正在导出", "completed": "已完成", "failed": "失败", "cancelled": "已取消"][value] ?? value
    }
}

private enum DeletionRequest: Identifiable {
    case one(DownloadTask)
    case all

    var id: String {
        switch self {
        case .one(let task): "one-\(task.id)"
        case .all: "all"
        }
    }
    var title: String { "删除下载记录？" }
    var message: String {
        switch self {
        case .one: "只会删除这条下载历史和缓存，不会删除已经导出的 TXT 或 EPUB 文件。"
        case .all: "只会删除全部已完成的下载历史和缓存，不会删除已经导出的 TXT 或 EPUB 文件。"
        }
    }
}

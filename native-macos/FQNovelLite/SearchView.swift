import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var model: LibraryModel
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    TextField("书名或作者", text: $model.query)
                        .textFieldStyle(.roundedBorder)
                        .focused($isSearchFocused)
                        .onSubmit { performSearch() }
                    Button("搜索", action: performSearch)
                        .buttonStyle(.borderedProminent)
                        .disabled(model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSearching)
                }
                .padding(20)

                Divider()
                resultsArea
            }

            if isSearchFocused, !model.searchHistory.isEmpty {
                SearchHistoryView { term in
                    model.query = term
                    performSearch()
                }
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                .shadow(color: .black.opacity(0.16), radius: 10, y: 5)
                .padding(.horizontal, 20)
                .padding(.top, 70)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private var resultsArea: some View {
        if let error = model.bridge.launchError {
            ContentUnavailableView("下载核心不可用", systemImage: "exclamationmark.triangle", description: Text(error))
        } else if !model.bridge.isReady {
            ContentUnavailableView("正在准备下载工具", systemImage: "book.closed", description: Text("首次启动可能需要几秒钟。"))
        } else if model.isSearching {
            VStack {
                Spacer()
                ProgressView("正在搜索…")
                Spacer()
            }
        } else if model.books.isEmpty {
            ContentUnavailableView("搜索你想保存的书", systemImage: "magnifyingglass", description: Text("输入书名或作者，开始搜索并下载。"))
        } else {
            List(model.books) { book in
                BookRow(book: book) { model.createDownload(book) }
            }
            .listStyle(.inset)
        }
    }

    private func performSearch() {
        isSearchFocused = false
        model.search()
    }
}

private struct BookRow: View {
    @EnvironmentObject private var model: LibraryModel
    let book: Book
    let download: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            CoverView(url: book.coverUrl, title: book.bookName)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(book.bookName).font(.headline)
                    if book.rating > 0 {
                        Text(String(format: "%.1f 分", book.rating))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.blue)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(.blue.opacity(0.12), in: Capsule())
                    }
                    Spacer()
                }
                Text(metadata).foregroundStyle(.secondary)
                if !book.description.isEmpty { Text(book.description).lineLimit(2).foregroundStyle(.secondary) }
                if !book.tags.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(book.tags.prefix(3), id: \.self) { tag in
                            Text(tag).font(.caption.weight(.medium)).foregroundStyle(.tint)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(.tint.opacity(0.10), in: Capsule())
                        }
                    }
                }
            }
            Button("下载 \(bookFormat)", action: download).buttonStyle(.bordered)
        }
        .padding(.vertical, 7)
    }

    private var metadata: String {
        var values = [book.author.isEmpty ? "未知作者" : book.author]
        if book.wordCount > 0 { values.append(formatWordCount(book.wordCount)) }
        if book.totalChapters > 0 { values.append("\(book.totalChapters) 章") }
        if !book.statusText.isEmpty { values.append(book.statusText) }
        if !book.readCntText.isEmpty { values.append(book.readCntText) }
        return values.joined(separator: " · ")
    }

    private var bookFormat: String { model.exportFormat.uppercased() }

    private func formatWordCount(_ value: Int) -> String {
        value >= 10_000 ? String(format: "%.1f 万字", Double(value) / 10_000) : "\(value) 字"
    }
}

private struct CoverView: View {
    let url: String
    let title: String
    var body: some View {
        AsyncImage(url: URL(string: url)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Image(systemName: "book.closed.fill").font(.title2).foregroundStyle(.tint)
        }
        .frame(width: 48, height: 66)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 5))
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .accessibilityLabel("《\(title)》封面")
    }
}

private struct SearchHistoryView: View {
    @EnvironmentObject private var model: LibraryModel
    let select: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("最近搜索").font(.headline)
                Spacer()
                Button("清除全部", role: .destructive) { model.clearSearchHistory() }
                    .buttonStyle(.borderless)
            }
            ForEach(model.searchHistory, id: \.self) { term in
                Button { select(term) } label: {
                    Label(term, systemImage: "clock")
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

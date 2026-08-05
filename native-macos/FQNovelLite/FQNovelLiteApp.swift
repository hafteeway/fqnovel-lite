import SwiftUI

@main
struct FQNovelLiteApp: App {
    @StateObject private var model = LibraryModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .frame(minWidth: 920, minHeight: 620)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("搜索书籍") { model.section = .search }
                    .keyboardShortcut("f", modifiers: .command)
            }
            CommandGroup(after: .appSettings) {
                Button("导出设置…") { model.section = .settings }
                    .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}

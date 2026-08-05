import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: LibraryModel

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $model.section) { section in
                Label(section.title, systemImage: section.icon)
                    .tag(section)
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190)
            .listStyle(.sidebar)
        } detail: {
            Group {
                switch model.section ?? .search {
                case .search: SearchView()
                case .downloads: DownloadsView()
                case .settings: SettingsView()
                }
            }
        }
        .task { model.start() }
        .alert(item: $model.alert) { alert in
            Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("好")))
        }
    }
}

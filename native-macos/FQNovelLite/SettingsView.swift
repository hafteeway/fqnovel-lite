import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: LibraryModel
    var body: some View {
        Form {
            Section("默认导出目录") {
                LabeledContent("位置") {
                    Text(model.exportDirectory).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                }
                Button("选择下载目录…") { model.chooseExportDirectory() }
            }
            Section("默认导出格式") {
                Picker("格式", selection: Binding(
                    get: { model.exportFormat },
                    set: { model.setExportFormat($0) }
                )) {
                    Text("EPUB").tag("epub")
                    Text("TXT").tag("txt")
                }
                .pickerStyle(.segmented)
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

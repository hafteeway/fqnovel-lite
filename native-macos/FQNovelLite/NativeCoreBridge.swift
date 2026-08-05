import Darwin
import Foundation

@MainActor
final class NativeCoreBridge: ObservableObject {
    @Published private(set) var status: RuntimeStatus?
    @Published private(set) var isReady = false
    @Published private(set) var launchError: String?

    private var process: Process?
    private var input: FileHandle?
    private var continuations: [String: CheckedContinuation<Data, Error>] = [:]
    private let decoder = JSONDecoder()
    private var outputBuffer = Data()
    private var stopping = false

    func start() {
        guard process == nil else { return }
        guard let nodeExecutable = Self.nodeExecutable else {
            launchError = "找不到 Node.js。请先在终端确认 node 已安装，再重新运行应用。"
            return
        }
        _ = Darwin.signal(SIGPIPE, SIG_IGN)
        stopping = false
        launchError = nil
        do {
            let runtimeRoot = Self.runtimeRoot
            let task = Process()
            let output = Pipe()
            let input = Pipe()
            task.executableURL = nodeExecutable
            task.arguments = [runtimeRoot.appending(path: "native-macos/bridge.mjs").path]
            task.currentDirectoryURL = runtimeRoot
            let inheritedPath = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
            task.environment = ProcessInfo.processInfo.environment.merging([
                "PATH": "/usr/local/bin:/opt/homebrew/bin:\(inheritedPath)",
                "FQNOVEL_DATA_DIR": Self.applicationDataDirectory.path,
                "FQNOVEL_NATIVE_PARENT_PID": String(ProcessInfo.processInfo.processIdentifier),
                "FQNOVEL_RUNTIME_ROOT": runtimeRoot.path,
                "FQNOVEL_JAVA_BIN": runtimeRoot.appending(path: "jre/bin/java").path
            ]) { _, new in new }
            task.standardOutput = output
            task.standardInput = input
            task.standardError = FileHandle.nullDevice
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                Task { @MainActor in self?.consume(data) }
            }
            task.terminationHandler = { [weak self] terminatedTask in
                Task { @MainActor in self?.handleTermination(terminatedTask) }
            }
            try task.run()
            process = task
            self.input = input.fileHandleForWriting
        } catch {
            process = nil
            input = nil
            launchError = "无法启动下载核心：\(error.localizedDescription)"
        }
    }

    func stop() {
        stopping = true
        process?.terminate()
        process = nil
        input = nil
        isReady = false
    }

    func request<T: Decodable>(_ action: String, payload: [String: Any] = [:], as: T.Type) async throws -> T {
        guard let process, process.isRunning, let input else { throw BridgeError.notStarted }
        let id = UUID().uuidString
        let message: [String: Any] = ["id": id, "action": action, "payload": payload]
        let data = try JSONSerialization.data(withJSONObject: message)
        return try await withCheckedThrowingContinuation { continuation in
            continuations[id] = continuation
            do {
                try input.write(contentsOf: data)
                try input.write(contentsOf: Data([0x0A]))
            } catch {
                continuations.removeValue(forKey: id)
                continuation.resume(throwing: BridgeError.connectionLost)
            }
        }.decoded(T.self, using: decoder)
    }

    private func handleTermination(_ terminatedTask: Process) {
        guard process === terminatedTask else { return }
        process = nil
        input = nil
        isReady = false
        let pending = continuations.values
        continuations.removeAll()
        for continuation in pending {
            continuation.resume(throwing: BridgeError.connectionLost)
        }
        if !stopping {
            launchError = "下载核心已退出（代码 \(terminatedTask.terminationStatus)）。请在终端运行 npm run build:worker 后重试。"
        }
    }

    private func consume(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 0x0A) {
            let line = outputBuffer.prefix(upTo: newline)
            outputBuffer.removeSubrange(...newline)
            guard !line.isEmpty, let message = try? decoder.decode(BridgeMessage.self, from: line) else { continue }
            if message.event == "ready" {
                isReady = true
                launchError = nil
                status = try? decoder.decode(RuntimeStatus.self, from: message.data ?? Data())
            } else if message.event == "status" {
                status = try? decoder.decode(RuntimeStatus.self, from: message.data ?? Data())
            } else if message.event == "fatal" {
                launchError = message.error ?? "下载核心启动失败"
            } else if let id = message.id, let continuation = continuations.removeValue(forKey: id) {
                if let error = message.error { continuation.resume(throwing: BridgeError.remote(error)) }
                else { continuation.resume(returning: message.data ?? Data()) }
            }
        }
    }

    private static var projectRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }

    private static var nodeExecutable: URL? {
        let bundledNode = runtimeRoot.appending(path: "bin/node")
        if FileManager.default.isExecutableFile(atPath: bundledNode.path) { return bundledNode }
        let candidates = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node"
        ]
        return candidates.first(where: FileManager.default.isExecutableFile(atPath:))
            .map(URL.init(fileURLWithPath:))
    }

    private static var runtimeRoot: URL {
        if let bundled = Bundle.main.resourceURL?.appending(path: "Runtime", directoryHint: .isDirectory),
           FileManager.default.fileExists(atPath: bundled.appending(path: "native-macos/bridge.mjs").path) {
            return bundled
        }
        return projectRoot
    }

    private static var applicationDataDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appending(path: "FQNovelLite/data", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

private struct BridgeMessage: Decodable {
    let id: String?
    let event: String?
    let data: Data?
    let error: String?

    enum CodingKeys: String, CodingKey { case id, event, data, error }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        event = try container.decodeIfPresent(String.self, forKey: .event)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        if container.contains(.data) {
            let value = try container.decode(JSONValue.self, forKey: .data)
            data = try JSONSerialization.data(withJSONObject: value.value)
        } else { data = nil }
    }
}

private enum JSONValue: Decodable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    var value: Any {
        switch self {
        case .object(let value): value.mapValues(\.value)
        case .array(let value): value.map(\.value)
        case .string(let value): value
        case .number(let value): value
        case .bool(let value): value
        case .null: NSNull()
        }
    }
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .array(try container.decode([JSONValue].self)) }
    }
}

private extension Data {
    func decoded<T: Decodable>(_ type: T.Type, using decoder: JSONDecoder) throws -> T { try decoder.decode(type, from: self) }
}

enum BridgeError: LocalizedError {
    case notStarted, connectionLost, remote(String)
    var errorDescription: String? {
        switch self {
        case .notStarted: "下载核心尚未准备完成，请稍候再试"
        case .connectionLost: "下载核心连接已断开，请重新启动应用"
        case .remote(let message): message
        }
    }
}

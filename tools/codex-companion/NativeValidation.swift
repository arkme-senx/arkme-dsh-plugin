import AppKit
import Foundation

// This entry point is deliberately NOT a generic dispatch API. Only the user-approved
// dedicated test conversation and fixed harmless fixtures are accepted. It is invoked
// explicitly by a developer via Launch Services, never by the GUI or on a timer.
let approvedNativeTestThread = "01a0f330-ac7b-7893-a977-f18dd8ea8abf"
let nativeValidationMessages = [
    "idle": "ARKME_COMPANION_IDLE_02：只回复 ARKME_COMPANION_IDLE_OK；不要调用工具，不要读取或修改文件。",
    "busy": "ARKME_COMPANION_BUSY_02：这是独立助手排队验证。请仅调用一次 clock.sleep 等待 45 秒，然后只回复 ARKME_COMPANION_BUSY_OK。此次明确允许这个等待工具；不要读取或修改文件、访问网络或执行其他操作。",
    "queue": "ARKME_COMPANION_QUEUE_02：只回复 ARKME_COMPANION_QUEUE_OK；不要调用工具，不要读取或修改文件。"
]

func validNativeValidationArguments(_ args: [String]) -> Bool {
    args.count == 4 && args[0] == "native-test" && args[1] == approvedNativeTestThread &&
        nativeValidationMessages[args[2]] != nil && args[3].hasPrefix("/") && !args[3].contains("/../")
}

private func privateDirectory(_ path: String) throws {
    var info = stat()
    guard lstat(path, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
          info.st_mode & 0o077 == 0, URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else {
        throw NativeInputError.blocked("private_directory_required")
    }
}

/** Cross-process exclusion for independently launched helper instances on this Mac. */
final class NativeValidationLock {
    private var fd: Int32 = -1
    init() throws {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = base.appendingPathComponent("ArkmeCodexCompanion", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try privateDirectory(directory.path)
        fd = open(directory.appendingPathComponent("native-input.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw NativeInputError.blocked("executor_lock_unavailable") }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
              info.st_mode & 0o077 == 0, flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            close(fd); fd = -1; throw NativeInputError.blocked("executor_busy")
        }
    }
    deinit { if fd >= 0 { flock(fd, LOCK_UN); close(fd) } }
}

func runNativeValidation(_ args: [String]) throws {
    guard validNativeValidationArguments(args), let body = nativeValidationMessages[args[2]],
          let target = UUID(uuidString: args[1]) else { throw NativeInputError.blocked("invalid_fixture_arguments") }
    let directory = URL(fileURLWithPath: args[3]).deletingLastPathComponent().path
    try privateDirectory(directory)
    let lock = try NativeValidationLock()
    try withExtendedLifetime(lock) {
        // Constructor checks this independently launched application's own permission.
        let input = try NativeCodexInput(stillAuthorized: { true })
        let id = UUID()
        let date = DateFormatter(); date.locale = Locale(identifier: "en_US_POSIX"); date.timeZone = .current
        date.dateFormat = "yyyy-MM-dd HH:mm:ss zzz (Z)"
        let text = "当前时间：\(date.string(from: Date()))\n\(body)"
        let intent = try JSONSerialization.data(withJSONObject: ["requestId": id.uuidString.lowercased(),
            "threadId": args[1], "kind": args[2], "state": "submitting", "createdAt": Date().timeIntervalSince1970], options: [.sortedKeys])
        let fd = open(args[3], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw NativeInputError.blocked("intent_exists_or_unwritable_never_retry") }
        let count = intent.withUnsafeBytes { write(fd, $0.baseAddress!, intent.count) }
        let synced = fsync(fd); close(fd)
        guard count == intent.count, synced == 0 else { throw NativeInputError.blocked("intent_persist_failed") }
        let action = try input.perform(NativeInputRequest(requestID: id, threadID: target, text: text), requiredFixture: "ARKME_NATIVE_READY")
        let result = try JSONSerialization.data(withJSONObject: ["mode": "explicit-dedicated-native-test", "action": action,
            "requestId": id.uuidString.lowercased(), "delivery": "unconfirmed", "doNotRetry": true], options: [.sortedKeys])
        FileHandle.standardOutput.write(result); FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

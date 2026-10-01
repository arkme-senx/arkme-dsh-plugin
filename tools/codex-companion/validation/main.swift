import AppKit
import ApplicationServices
import Foundation

// Developer-only native UI feasibility test. Never built into the authorized
// read-only companion, never reads cloud commands, and never edits Codex storage.
// A fixture marker is necessary but is NOT sufficient proof of thread identity.
enum ValidationError: Error { case blocked(String) }

let testMessages = [
    "idle": "ARKME_NATIVE_TEST_IDLE_01：只回复 ARKME_NATIVE_IDLE_OK；不要调用工具，不要读取或修改文件。",
    "busy": "ARKME_NATIVE_TEST_BUSY_01：这是原生排队测试。请仅调用一次 clock.sleep 等待 45 秒，然后只回复 ARKME_NATIVE_BUSY_OK。此次明确允许这个等待工具；不要读取或修改文件、访问网络或执行其他操作。",
    "queue": "ARKME_NATIVE_TEST_QUEUE_01：只回复 ARKME_NATIVE_QUEUE_OK；不要调用工具，不要读取或修改文件。"
]

func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(element, key as CFString, &value)
    return value
}

func text(_ element: AXUIElement, _ key: String) -> String {
    attribute(element, key) as? String ?? ""
}

final class NativeFixture {
    let app: NSRunningApplication
    let root: AXUIElement

    init() throws {
        guard AXIsProcessTrusted() else { throw ValidationError.blocked("permission_required") }
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
        guard apps.count == 1 else { throw ValidationError.blocked("ambiguous_app") }
        app = apps[0]
        root = AXUIElementCreateApplication(app.processIdentifier)
        guard AXUIElementSetMessagingTimeout(root, 0.25) == .success else {
            throw ValidationError.blocked("ax_timeout_configuration")
        }
    }

    func nodes() throws -> [AXUIElement] {
        guard let windows = attribute(root, "AXWindows") as? [AXUIElement] else {
            throw ValidationError.blocked("windows_unavailable")
        }
        guard windows.count == 1 else { throw ValidationError.blocked("window_count_\(windows.count)") }
        var pending = windows
        var result: [AXUIElement] = []
        let deadline = Date().addingTimeInterval(3)
        while let element = pending.popLast() {
            guard result.count < 2500, Date() < deadline else { throw ValidationError.blocked("incomplete_snapshot") }
            // Do not inspect other tasks or native OS menu history.
            if text(element, "AXDOMIdentifier") == "app-shell-sidebar" { continue }
            result.append(element)
            if let children = attribute(element, "AXChildren") as? [AXUIElement] {
                pending.append(contentsOf: children)
            }
        }
        return result
    }

    func requireFixture() throws {
        guard try nodes().contains(where: { text($0, "AXRole") == "AXStaticText" && text($0, "AXValue") == "ARKME_NATIVE_READY" }) else {
            throw ValidationError.blocked("test_fixture_not_visible")
        }
    }

    func press(role: String, title: String) throws {
        try requireFixture()
        let matches = try nodes().filter { text($0, "AXRole") == role && text($0, "AXTitle") == title }
        guard matches.count == 1 else { throw ValidationError.blocked("control_not_unique: \(title)") }
        guard AXUIElementPerformAction(matches[0], kAXPressAction as CFString) == .success else {
            throw ValidationError.blocked("press_failed: \(title)")
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    }

    func openCopyMenu() throws {
        try requireFixture()
        if try nodes().contains(where: { text($0, "AXRole") == "AXMenuItem" && text($0, "AXTitle") == "复制深度链接" }) { return }
        if try !nodes().contains(where: { text($0, "AXRole") == "AXMenuItem" && text($0, "AXTitle") == "复制" }) {
            try press(role: "AXPopUpButton", title: "聊天操作")
        }
        try press(role: "AXMenuItem", title: "复制")
    }

    func verifyThread(_ expected: UUID) throws {
        try requireFixture()
        let pasteboard = NSPasteboard.general
        let originalChange = pasteboard.changeCount
        var saved: [[NSPasteboard.PasteboardType: Data]] = []
        var size = 0
        for item in pasteboard.pasteboardItems ?? [] {
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                guard let data = item.data(forType: type) else { throw ValidationError.blocked("clipboard_not_restorable") }
                size += data.count
                guard size <= 1_048_576 else { throw ValidationError.blocked("clipboard_too_large") }
                values[type] = data
            }
            saved.append(values)
        }
        try openCopyMenu()
        guard pasteboard.changeCount == originalChange else { throw ValidationError.blocked("clipboard_changed_by_user") }
        try press(role: "AXMenuItem", title: "复制深度链接")
        let copiedChange = pasteboard.changeCount
        guard copiedChange == originalChange + 1,
              let link = pasteboard.string(forType: .string),
              let url = URL(string: link), url.scheme == "codex", url.host == "threads",
              url.query == nil, url.fragment == nil, url.user == nil, url.password == nil,
              url.path.split(separator: "/").count == 1,
              let actual = UUID(uuidString: String(url.path.dropFirst())) else {
            // An unexpected clipboard change could belong to the user: never overwrite it.
            throw ValidationError.blocked("copy_thread_identity_unconfirmed")
        }
        guard pasteboard.changeCount == copiedChange else { throw ValidationError.blocked("clipboard_changed_by_user") }
        let restored = saved.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        pasteboard.clearContents()
        guard restored.isEmpty || pasteboard.writeObjects(restored) else { throw ValidationError.blocked("clipboard_restore_failed") }
        guard actual == expected else { throw ValidationError.blocked("wrong_thread") }
        try requireFixture()
        print("threadIdentityVerified=true clipboardRestored=true")
    }

    func editor() throws -> AXUIElement {
        let editors = try nodes().filter { text($0, "AXRole") == "AXTextArea" }
        guard editors.count == 1 else { throw ValidationError.blocked("editor_not_unique") }
        let editor = editors[0]
        guard (attribute(editor, "AXDOMClassList") as? [String] ?? []).contains("ProseMirror") else {
            throw ValidationError.blocked("unsupported_editor")
        }
        return editor
    }

    func stageTest(_ expected: UUID, kind: String) throws {
        try verifyThread(expected)
        let editor = try editor()
        let children = attribute(editor, "AXChildren") as? [AXUIElement] ?? []
        let hint = text(editor, "AXDescription")
        guard ["随心输入", "Ask anything"].contains(hint), children.count == 1,
              (attribute(children[0], "AXDOMClassList") as? [String] ?? []).contains("placeholder"),
              text(editor, "AXValue").trimmingCharacters(in: .whitespacesAndNewlines) == hint else {
            throw ValidationError.blocked("draft_present_or_empty_state_unknown")
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
            throw ValidationError.blocked("focus_lost")
        }
        guard let value = testMessages[kind] else { throw ValidationError.blocked("unknown_fixture_kind") }
        let result = AXUIElementSetAttributeValue(editor, kAXValueAttribute as CFString, value as CFString)
        guard result == .success else { throw ValidationError.blocked("stage_failed_\(result.rawValue)") }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        guard text(editor, "AXValue").trimmingCharacters(in: .whitespacesAndNewlines) == value else {
            throw ValidationError.blocked("stage_result_unknown_no_submit")
        }
        print("staged=true submitted=false")
        for element in try nodes() where ["AXButton", "AXPopUpButton"].contains(text(element, "AXRole")) {
            let title = text(element, "AXTitle")
            if ["发送", "发送消息", "停止", "加入队列", "排队", "Send", "Queue", "Steer"].contains(title) {
                print("submissionControl=\(title)")
            }
        }
    }

    func inspectComposer(_ expected: UUID) throws {
        try verifyThread(expected)
        guard let rawParent = attribute(try editor(), "AXParent"), CFGetTypeID(rawParent) == AXUIElementGetTypeID() else {
            throw ValidationError.blocked("composer_parent_unavailable")
        }
        var pending = [unsafeBitCast(rawParent, to: AXUIElement.self)]
        var visited = 0
        while let element = pending.popLast() {
            visited += 1
            guard visited < 150 else { throw ValidationError.blocked("composer_snapshot_incomplete") }
            let role = text(element, "AXRole")
            if ["AXButton", "AXPopUpButton"].contains(role) {
                print("control role=\(role) title=\(text(element, "AXTitle")) description=\(text(element, "AXDescription")) help=\(text(element, "AXHelp"))")
            }
            if let children = attribute(element, "AXChildren") as? [AXUIElement] { pending.append(contentsOf: children) }
        }
    }

    func clearTestDraft(_ expected: UUID, kind: String) throws {
        try verifyThread(expected)
        let editor = try editor()
        guard let value = testMessages[kind],
              text(editor, "AXValue").trimmingCharacters(in: .whitespacesAndNewlines) == value else {
            throw ValidationError.blocked("not_exact_test_draft_never_clear")
        }
        guard AXUIElementSetAttributeValue(editor, kAXValueAttribute as CFString, "" as CFString) == .success else {
            throw ValidationError.blocked("test_draft_clear_failed")
        }
        print("ownTestDraftCleared=true")
    }

    func submitTest(_ expected: UUID, kind: String, journal: String) throws {
        try verifyThread(expected)
        guard let value = testMessages[kind],
              text(try editor(), "AXValue").trimmingCharacters(in: .whitespacesAndNewlines) == value else {
            throw ValidationError.blocked("not_exact_test_draft")
        }
        let snapshot = try nodes()
        let expectedAction = kind == "queue" ? "排队" : "发送"
        let send = snapshot.filter { text($0, "AXRole") == "AXButton" && text($0, "AXTitle") == expectedAction }
        guard send.count == 1, NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
            throw ValidationError.blocked("send_control_or_focus_invalid")
        }
        guard journal.hasPrefix("/"), !FileManager.default.fileExists(atPath: journal) else {
            throw ValidationError.blocked("journal_exists_never_resubmit")
        }
        // Durable intent before the only potentially submitting operation. No automatic retry.
        let record = try JSONSerialization.data(withJSONObject: ["status": "submitting", "kind": kind,
            "threadId": expected.uuidString.lowercased(), "at": ISO8601DateFormatter().string(from: Date())], options: [.sortedKeys])
        let fd = open(journal, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw ValidationError.blocked("journal_create_failed") }
        let written = record.withUnsafeBytes { write(fd, $0.baseAddress!, record.count) }
        let synced = fsync(fd)
        close(fd)
        guard written == record.count, synced == 0 else { throw ValidationError.blocked("journal_persist_failed") }
        try requireFixture()
        guard text(try editor(), "AXValue").trimmingCharacters(in: .whitespacesAndNewlines) == value,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
            throw ValidationError.blocked("draft_or_focus_changed_after_journal")
        }
        guard text(send[0], "AXTitle") == expectedAction else { throw ValidationError.blocked("submission_mode_changed") }
        let result = AXUIElementPerformAction(send[0], kAXPressAction as CFString)
        print("nativeSubmitAction=\(result.rawValue) delivery=unconfirmed journalPersisted=true doNotRetry=true")
    }
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args == ["probe-copy-menu"]
        || (args.count == 2 && ["verify-thread", "navigate-verify", "inspect-composer"].contains(args[0]) && UUID(uuidString: args[1]) != nil)
        || (args.count == 3 && ["stage-test", "clear-test-draft"].contains(args[0]) && UUID(uuidString: args[1]) != nil && testMessages[args[2]] != nil)
        || (args.count == 4 && args[0] == "submit-test" && UUID(uuidString: args[1]) != nil && testMessages[args[2]] != nil) else {
        throw ValidationError.blocked("usage: native-validation probe-copy-menu | verify-thread UUID | stage-test UUID idle|busy|queue | submit-test UUID idle|busy JOURNAL")
    }
    let fixture = try NativeFixture()
    if args[0] == "navigate-verify" {
        // Only a validated local thread ID, never an arbitrary URL supplied remotely.
        let target = UUID(uuidString: args[1])!.uuidString.lowercased()
        guard NSWorkspace.shared.open(URL(string: "codex://threads/\(target)")!) else {
            throw ValidationError.blocked("navigation_dispatch_failed")
        }
    }
    fixture.app.activate(options: [])
    RunLoop.current.run(until: Date().addingTimeInterval(0.4))
    if args[0] == "clear-test-draft" {
        try fixture.clearTestDraft(UUID(uuidString: args[1])!, kind: args[2])
    } else if args[0] == "inspect-composer" {
        try fixture.inspectComposer(UUID(uuidString: args[1])!)
    } else if args[0] == "submit-test" {
        try fixture.submitTest(UUID(uuidString: args[1])!, kind: args[2], journal: args[3])
    } else if args[0] == "stage-test" {
        try fixture.stageTest(UUID(uuidString: args[1])!, kind: args[2])
    } else if args[0] == "verify-thread" || args[0] == "navigate-verify" {
        try fixture.verifyThread(UUID(uuidString: args[1])!)
    } else {
        try fixture.openCopyMenu()
        for element in try fixture.nodes() where text(element, "AXRole") == "AXMenuItem" {
            print("menu=\(text(element, "AXTitle"))")
        }
    }
} catch {
    FileHandle.standardError.write(Data("REFUSED: \(error)\n".utf8))
    exit(1)
}

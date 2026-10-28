import AppKit
import ApplicationServices
import Foundation

// Native adapter library. Not enabled by Doctor or by the read-only companion.
// The trusted dispatcher must persist intent BEFORE calling perform and reconcile
// NEW queue/turn evidence afterwards. AXPress success is never a delivery receipt.
struct NativeInputRequest {
    let requestID: UUID
    let threadID: UUID
    let text: String
}

enum NativeInputError: Error, Equatable {
    case blocked(String)
}

enum NativeInputPolicy {
    static let verifiedVersions: Set<String> = ["26.924.22138"]
    static func validateText(_ value: String) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= 16_384 &&
            !value.unicodeScalars.contains { ($0.value < 32 && ![9, 10, 13].contains($0.value)) || $0.value == 127 }
    }
    static func emptyEditor(value: String, description: String, childClasses: [[String]]) -> Bool {
        ["随心输入", "Ask anything"].contains(description) && childClasses.count == 1 &&
            childClasses[0].contains("placeholder") && value.trimmingCharacters(in: .whitespacesAndNewlines) == description
    }
    static func target(from link: String) -> UUID? {
        guard let url = URL(string: link), url.scheme == "codex", url.host == "threads",
              url.port == nil, url.query == nil, url.fragment == nil, url.user == nil, url.password == nil,
              url.path.split(separator: "/").count == 1,
              let id = UUID(uuidString: String(url.path.dropFirst())), link == "codex://threads/\(id.uuidString.lowercased())" else { return nil }
        return id
    }
    static func submissionAction(titles: [String], busy: Bool) -> String? {
        // Queue only; changing the user's default follow-up preference is not permitted.
        let candidates = titles.filter { ["发送", "排队", "Send", "Queue"].contains($0) }
        guard candidates.count == 1 else { return nil }
        if busy { return ["排队", "Queue"].contains(candidates[0]) ? candidates[0] : nil }
        return ["发送", "Send"].contains(candidates[0]) ? candidates[0] : nil
    }
    static func allowedComposerControl(role: String, title: String) -> Bool {
        if role == "AXPopUpButton" {
            return ["更改权限", "Change permissions"].contains(title) || title.hasPrefix("GPT-")
        }
        return ["开启语音聊天", "听写", "添加文件等内容", "发送", "排队", "停止", "引导",
                "Start voice chat", "Dictate", "Add files and more", "Send", "Queue", "Stop", "Steer"].contains(title)
    }
}

private func nativeAttribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(element, key as CFString, &value)
    return value
}
private func nativeText(_ element: AXUIElement, _ key: String) -> String {
    nativeAttribute(element, key) as? String ?? ""
}
private func nativeChildren(_ element: AXUIElement) throws -> [AXUIElement] {
    var raw: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &raw)
    if error == .attributeUnsupported || error == .noValue { return [] }
    guard error == .success, let values = raw as? [AnyObject],
          values.allSatisfy({ CFGetTypeID($0) == AXUIElementGetTypeID() }) else {
        throw NativeInputError.blocked("incomplete_snapshot")
    }
    return values.map { unsafeBitCast($0, to: AXUIElement.self) }
}

/** All entry points run on the main thread; caller must hold the machine-wide executor lock. */
final class NativeCodexInput {
    private let app: NSRunningApplication
    private let root: AXUIElement
    private let events: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .rightMouseDown,
                                        .otherMouseDown, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .scrollWheel]
    private let eventCounts: [UInt32]
    private let stillAuthorized: () -> Bool
    private let deadline: Date
    private var expectedFrontmost: pid_t?

    init(stillAuthorized: @escaping () -> Bool) throws {
        guard Thread.isMainThread, AXIsProcessTrusted() else { throw NativeInputError.blocked("permission_required") }
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
        guard apps.count == 1, let version = apps[0].bundleURL.flatMap({ Bundle(url: $0)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String }),
              NativeInputPolicy.verifiedVersions.contains(version) else { throw NativeInputError.blocked("codex_version_unverified") }
        app = apps[0]
        root = AXUIElementCreateApplication(app.processIdentifier)
        guard AXUIElementSetMessagingTimeout(root, 0.25) == .success else { throw NativeInputError.blocked("ax_timeout_configuration") }
        self.stillAuthorized = stillAuthorized
        deadline = Date().addingTimeInterval(20)
        eventCounts = events.map { CGEventSource.counterForEventType(.hidSystemState, eventType: $0) }
        // Do not take the foreground directly after a local click or while the user is typing.
        guard events.allSatisfy({ CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: $0) >= 2 }) else {
            throw NativeInputError.blocked("user_active")
        }
        try guardOperation()
    }

    private func userUnchanged() -> Bool {
        zip(events, eventCounts).allSatisfy { CGEventSource.counterForEventType(.hidSystemState, eventType: $0.0) == $0.1 }
    }
    private func guardOperation() throws {
        guard Date() < deadline, stillAuthorized() else { throw NativeInputError.blocked("authorization_changed") }
        guard AXIsProcessTrusted() else { throw NativeInputError.blocked("permission_required") }
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
              session["kCGSessionOnConsoleKey"] as? Bool == true,
              session["CGSSessionScreenIsLocked"] as? Bool != true else { throw NativeInputError.blocked("locked") }
        guard userUnchanged() else { throw NativeInputError.blocked("user_active") }
        if let expectedFrontmost, NSWorkspace.shared.frontmostApplication?.processIdentifier != expectedFrontmost {
            throw NativeInputError.blocked("focus_lost")
        }
    }

    private func tree(_ start: [AXUIElement], limit: Int, skipSidebar: Bool = false) throws -> [AXUIElement] {
        var pending = start, result: [AXUIElement] = []
        while let element = pending.popLast() {
            try guardOperation()
            guard result.count < limit else { throw NativeInputError.blocked("incomplete_snapshot") }
            if skipSidebar && nativeText(element, "AXDOMIdentifier") == "app-shell-sidebar" { continue }
            result.append(element)
            pending.append(contentsOf: try nativeChildren(element))
        }
        return result
    }
    private func nodes() throws -> [AXUIElement] {
        guard let windows = nativeAttribute(root, "AXWindows") as? [AXUIElement], windows.count == 1 else {
            throw NativeInputError.blocked("ambiguous_window")
        }
        return try tree(windows, limit: 2500, skipSidebar: true)
    }
    private func pause(_ interval: TimeInterval = 0.15) throws {
        RunLoop.current.run(until: Date().addingTimeInterval(interval))
        try guardOperation()
    }
    private func press(role: String, title: String) throws {
        let matches = try nodes().filter { nativeText($0, "AXRole") == role && nativeText($0, "AXTitle") == title }
        guard matches.count == 1 else { throw NativeInputError.blocked("control_not_unique") }
        try guardOperation()
        guard AXUIElementPerformAction(matches[0], kAXPressAction as CFString) == .success else { throw NativeInputError.blocked("press_unconfirmed") }
        try pause()
    }

    private func verifiedThread() throws -> UUID {
        let pasteboard = NSPasteboard.general, originalChange = NSPasteboard.general.changeCount
        var saved: [[NSPasteboard.PasteboardType: Data]] = [], size = 0
        for item in pasteboard.pasteboardItems ?? [] {
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                guard let data = item.data(forType: type) else { throw NativeInputError.blocked("clipboard_not_restorable") }
                size += data.count
                guard size <= 1_048_576 else { throw NativeInputError.blocked("clipboard_too_large") }
                values[type] = data
            }
            saved.append(values)
        }
        // This adapter is deliberately version/locale bounded. Unknown labels fail closed.
        try press(role: "AXPopUpButton", title: "聊天操作")
        try press(role: "AXMenuItem", title: "复制")
        guard pasteboard.changeCount == originalChange else { throw NativeInputError.blocked("clipboard_changed") }
        try press(role: "AXMenuItem", title: "复制深度链接")
        let copied = pasteboard.changeCount
        guard copied == originalChange + 1, let value = pasteboard.string(forType: .string),
              let actual = NativeInputPolicy.target(from: value) else { throw NativeInputError.blocked("identity_unconfirmed") }
        guard pasteboard.changeCount == copied else { throw NativeInputError.blocked("clipboard_changed") }
        let restored = saved.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem(); for (type, data) in values { item.setData(data, forType: type) }; return item
        }
        pasteboard.clearContents()
        guard restored.isEmpty || pasteboard.writeObjects(restored) else { throw NativeInputError.blocked("clipboard_restore_failed") }
        return actual
    }

    private func editorAndComposer() throws -> (AXUIElement, [AXUIElement]) {
        let editors = try nodes().filter { nativeText($0, "AXRole") == "AXTextArea" }
        guard editors.count == 1,
              (nativeAttribute(editors[0], "AXDOMClassList") as? [String] ?? []).contains("ProseMirror"),
              let parent = nativeAttribute(editors[0], "AXParent"), CFGetTypeID(parent) == AXUIElementGetTypeID() else {
            throw NativeInputError.blocked("unsupported_composer")
        }
        let composer = try tree([unsafeBitCast(parent, to: AXUIElement.self)], limit: 150)
        for item in composer {
            let role = nativeText(item, "AXRole")
            // Unknown chips/removal controls must not accidentally submit files, mentions or modes.
            if ["AXImage", "AXLink", "AXCheckBox"].contains(role) { throw NativeInputError.blocked("attachments_or_extra_context") }
            if ["AXButton", "AXPopUpButton"].contains(role), !NativeInputPolicy.allowedComposerControl(role: role, title: nativeText(item, "AXTitle")) {
                throw NativeInputError.blocked("unsupported_composer_control")
            }
        }
        return (editors[0], composer)
    }

    /** Returns the native action attempted; caller MUST keep delivery unconfirmed until independently reconciled. */
    func perform(_ request: NativeInputRequest, requiredFixture: String? = nil) throws -> String {
        guard NativeInputPolicy.validateText(request.text) else { throw NativeInputError.blocked("invalid_text") }
        try guardOperation()
        let previous = NSWorkspace.shared.frontmostApplication
        defer {
            // Never steal focus back after user interaction. We only restore the app, not a guessed thread.
            if userUnchanged(), NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
               let previous, previous.processIdentifier != app.processIdentifier { previous.activate(options: []) }
        }
        guard NSWorkspace.shared.open(URL(string: "codex://threads/\(request.threadID.uuidString.lowercased())")!) else {
            throw NativeInputError.blocked("navigation_failed")
        }
        app.activate(options: [])
        try pause(0.5)
        expectedFrontmost = app.processIdentifier
        guard try verifiedThread() == request.threadID else { throw NativeInputError.blocked("wrong_thread") }
        if let requiredFixture {
            guard try nodes().contains(where: { nativeText($0, "AXRole") == "AXStaticText" && nativeText($0, "AXValue") == requiredFixture }) else {
                throw NativeInputError.blocked("test_fixture_missing")
            }
        }
        let (editor, _) = try editorAndComposer()
        let children = try nativeChildren(editor)
        guard NativeInputPolicy.emptyEditor(value: nativeText(editor, "AXValue"), description: nativeText(editor, "AXDescription"),
                childClasses: children.map { nativeAttribute($0, "AXDOMClassList") as? [String] ?? [] }) else {
            throw NativeInputError.blocked("draft_present")
        }
        try guardOperation()
        guard AXUIElementSetAttributeValue(editor, kAXValueAttribute as CFString, request.text as CFString) == .success else {
            throw NativeInputError.blocked("stage_unconfirmed")
        }
        try pause()
        guard try verifiedThread() == request.threadID else { throw NativeInputError.blocked("wrong_thread") }
        let (currentEditor, composer) = try editorAndComposer()
        // ProseMirror adds one final newline to AXValue. Do NOT trim arbitrary user whitespace.
        let value = nativeText(currentEditor, "AXValue")
        guard value == request.text || value == request.text + "\n" else { throw NativeInputError.blocked("draft_changed") }
        let buttons = composer.filter { nativeText($0, "AXRole") == "AXButton" }
        let titles = buttons.map { nativeText($0, "AXTitle") }
        guard let action = NativeInputPolicy.submissionAction(titles: titles, busy: titles.contains("停止") || titles.contains("Stop")),
              let button = buttons.first(where: { nativeText($0, "AXTitle") == action }) else {
            throw NativeInputError.blocked("queue_action_unavailable")
        }
        try guardOperation()
        guard nativeText(button, "AXTitle") == action,
              nativeText(currentEditor, "AXValue") == value else { throw NativeInputError.blocked("submission_state_changed") }
        // Exactly one press; no catch/retry/keyboard fallback. Failure is ambiguous too.
        guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else { throw NativeInputError.blocked("submit_unconfirmed") }
        return action
    }
}

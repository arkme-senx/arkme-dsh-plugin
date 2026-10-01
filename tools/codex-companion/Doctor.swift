import AppKit
import ApplicationServices
import Foundation

// Read-only native capability probe. It deliberately has no input, activation,
// clipboard, network, TCC prompt, queue-write or app-server launch operations.
// A successful probe is NOT proof that a request can be submitted safely.
let codexBundleID = "com.openai.codex"

struct EditorProbe: Encodable {
    let attributes: [String]
    let description: String?
    let placeholder: String?
    let valueLength: Int?
    let valueSettable: Bool
}

struct WindowProbe: Encodable {
    let readable: Bool
    let nodesVisited: Int
    let traversalComplete: Bool
    let roleCounts: [String: Int]
    let editableElementCount: Int
    let nonemptyEditableElementCount: Int
    let errors: [Int32]
    let editors: [EditorProbe]
    let queueControlLabels: [String]
    let threadIDsFromDocumentURL: [String]
}

struct DoctorReport: Encodable {
    let schemaVersion = 1
    let mode = "read-only-doctor"
    let checkedAt: String
    let accessibilityTrusted: Bool
    let screenLocked: Bool?
    let appBundleID: String
    let appVersion: String?
    let appProcessCount: Int
    let windowCount: Int?
    let windows: [WindowProbe]
    let blockers: [String]
    let nativeQueueSubmissionVerified = false
}

func read(_ element: AXUIElement, _ name: CFString) -> (CFTypeRef?, AXError) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name, &value)
    return (value, error)
}

func elementArray(_ value: CFTypeRef?) -> [AXUIElement]? {
    guard let values = value as? [AnyObject],
          values.allSatisfy({ CFGetTypeID($0) == AXUIElementGetTypeID() }) else { return nil }
    return values.map { unsafeBitCast($0, to: AXUIElement.self) }
}

func inspectWindow(_ window: AXUIElement, deadline: Date) -> WindowProbe {
    var pending = [window]
    var seen = Set<CFHashCode>()
    var roles: [String: Int] = [:]
    var editable = 0, nonempty = 0, visited = 0
    var errors = Set<Int32>()
    var editors: [EditorProbe] = []
    var queueControlLabels = Set<String>()
    var threadIDs = Set<String>()
    let editableRoles = ["AXTextArea", "AXTextField", "AXSearchField"]
    while let element = pending.popLast() {
        if visited >= 2000 || Date() >= deadline { pending.append(element); break }
        // Hash collisions only reduce diagnostic coverage, never permit sending.
        guard seen.insert(CFHash(element)).inserted else { continue }
        visited += 1
        let (roleValue, roleError) = read(element, kAXRoleAttribute as CFString)
        if roleError != .success { errors.insert(roleError.rawValue) }
        let role = roleValue as? String ?? "unreadable"
        roles[role, default: 0] += 1
        if editableRoles.contains(role) {
            editable += 1
            let (value, error) = read(element, kAXValueAttribute as CFString)
            if error == .success, let text = value as? String, !text.isEmpty { nonempty += 1 }
            // Values stay inside the probe; no message, draft, title or path is output.
            if error != .success { errors.insert(error.rawValue) }
            var names: CFArray?
            AXUIElementCopyAttributeNames(element, &names)
            var settable = DarwinBoolean(false)
            AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
            // Only known UI strings can leave the process; never output user drafts.
            let knownHints = ["随心输入", "随心输入…", "随心输入...", "Ask anything", "Ask anything…", "Message Codex", "Ask Codex anything"]
            let description = read(element, kAXDescriptionAttribute as CFString).0 as? String
            let placeholder = read(element, "AXPlaceholderValue" as CFString).0 as? String
            editors.append(EditorProbe(attributes: (names as? [String] ?? []).sorted(),
                description: description.flatMap { knownHints.contains($0) ? $0 : nil },
                placeholder: placeholder.flatMap { knownHints.contains($0) ? $0 : nil },
                valueLength: (value as? String)?.count, valueSettable: settable.boolValue))
        }
        if ["AXWindow", "AXWebArea"].contains(role) {
            for key in [kAXDocumentAttribute as CFString, kAXURLAttribute as CFString] {
                let raw = read(element, key).0
                let url = (raw as? URL) ?? (raw as? String).flatMap(URL.init(string:))
                if let url, url.scheme == "codex", url.host == "threads",
                   let first = url.path.split(separator: "/").first,
                   UUID(uuidString: String(first)) != nil { threadIDs.insert(String(first)) }
            }
        }
        if role == "AXButton" || role == "AXPopUpButton" {
            let knownLabels: Set<String> = ["Send", "Send message", "Queue", "Queue message", "Add to queue", "Stop", "Stop generating", "Steer", "发送", "发送消息", "加入队列", "排队", "停止", "停止生成", "引导", "复制链接", "Copy link"]
            for key in [kAXTitleAttribute as CFString, kAXDescriptionAttribute as CFString, kAXHelpAttribute as CFString] {
                if let text = read(element, key).0 as? String, knownLabels.contains(text) {
                    queueControlLabels.insert(text)
                }
            }
        }
        let (children, error) = read(element, kAXChildrenAttribute as CFString)
        if error == .success {
            if let elements = elementArray(children) { pending.append(contentsOf: elements) }
            else if children == nil { /* Native leaf with no children. */ }
            else { errors.insert(AXError.illegalArgument.rawValue) }
        } else if error != .attributeUnsupported && error != .noValue { errors.insert(error.rawValue) }
    }
    return WindowProbe(readable: roles.keys.contains(where: { $0 != "unreadable" }),
        nodesVisited: visited, traversalComplete: pending.isEmpty && errors.isEmpty,
        roleCounts: roles, editableElementCount: editable,
        nonemptyEditableElementCount: nonempty, errors: errors.sorted(), editors: editors,
        queueControlLabels: queueControlLabels.sorted(), threadIDsFromDocumentURL: threadIDs.sorted())
}

func doctor() -> DoctorReport {
    let trusted = AXIsProcessTrusted() // Never use the prompt option implicitly.
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    let locked = session?["CGSSessionScreenIsLocked"] as? Bool
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: codexBundleID)
    let app = apps.count == 1 ? apps.first : nil
    let version = app?.bundleURL.flatMap { Bundle(url: $0)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String }
    var blockers: [String] = []
    var windows: [WindowProbe] = []
    var windowCount: Int?
    if !trusted { blockers.append("accessibility_permission_required") }
    if apps.isEmpty { blockers.append("codex_not_running") }
    if apps.count > 1 { blockers.append("ambiguous_codex_process") }
    if locked == true { blockers.append("screen_locked") }
    if trusted, let app, locked != true {
        let application = AXUIElementCreateApplication(app.processIdentifier)
        let timeoutError = AXUIElementSetMessagingTimeout(application, 0.3)
        if timeoutError != .success { blockers.append("ax_timeout_configuration_failed") }
        else {
            let (raw, error) = read(application, kAXWindowsAttribute as CFString)
            if error == .success, let nativeWindows = elementArray(raw) {
                windowCount = nativeWindows.count
                if nativeWindows.isEmpty { blockers.append("no_accessible_windows") }
                let deadline = Date().addingTimeInterval(5)
                for window in nativeWindows.prefix(5) {
                    if Date() >= deadline { break }
                    windows.append(inspectWindow(window, deadline: deadline))
                }
                if windows.count != nativeWindows.count || windows.contains(where: { !$0.traversalComplete }) {
                    blockers.append("ax_inspection_incomplete")
                }
            } else { blockers.append("ax_windows_unavailable_\(error.rawValue)") }
        }
    }
    // No adapter is enabled until exact-thread, draft protection, queue action,
    // and acknowledgement are validated against this installed app version.
    blockers.append("native_submission_adapter_not_validated")
    return DoctorReport(checkedAt: ISO8601DateFormatter().string(from: Date()),
        accessibilityTrusted: trusted, screenLocked: locked,
        appBundleID: codexBundleID, appVersion: version, appProcessCount: apps.count,
        windowCount: windowCount, windows: windows, blockers: blockers)
}

func encodeReport(_ report: DoctorReport) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return try encoder.encode(report)
}

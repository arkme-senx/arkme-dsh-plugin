import AppKit
import ApplicationServices
import Foundation

// The normal GUI remains read-only. The separate native-test CLI accepts only
// the explicitly authorized dedicated fixture, not arbitrary user or cloud input.
// Launching the GUI never enables remote control or changes Codex settings.
final class CompanionDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem?
    private let menu = NSMenu()
    private var report: DoctorReport?
    private let guideCopy = PermissionGuideCopy(systemMajorVersion: ProcessInfo.processInfo.operatingSystemVersion.majorVersion,
        appName: Bundle.main.bundleURL.lastPathComponent)
    private var permission = PermissionGuideState(trusted: AXIsProcessTrusted())
    private var permissionWindow: NSWindow?
    private var permissionStatusLabel: NSTextField?
    private var permissionNoticeLabel: NSTextField?
    private var permissionTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "Arkme ↔ Codex"
        statusItem?.button?.toolTip = "Arkme Codex 连接助手 · 只读验证版"
        menu.delegate = self
        statusItem?.menu = menu
        refresh()
        NotificationCenter.default.addObserver(self, selector: #selector(checkPermission), name: NSApplication.didBecomeActiveNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(checkPermission), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        permissionTimer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, self.permission.shouldPoll(guideVisible: self.permissionWindow?.isVisible == true, now: Date()) else { return }
            self.checkPermission()
        }
        RunLoop.main.add(permissionTimer!, forMode: .common)
        if !permission.trusted { showPermissionGuide() }
    }

    private func row(_ title: String, action: Selector? = nil) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        if action != nil { item.target = self }
        menu.addItem(item)
    }

    @objc private func refresh() {
        let current = doctor()
        report = current
        permission.trusted = current.accessibilityTrusted
        renderMenu()
        renderPermissionGuide()
    }

    private func renderMenu() {
        menu.removeAllItems()
        row("本机连接助手 · 只读验证版")
        row("自动输入：未开启，原生队列尚未验证")
        menu.addItem(.separator())
        row(report?.appProcessCount == 1 ? "Codex：正在运行" : "Codex：未找到唯一运行实例")
        row("\(guideCopy.pageTitle)：\(permission.trusted ? "已授权" : "尚未授权")")
        if report?.screenLocked == true { row("桌面：已锁屏") }
        if permission.trusted, let count = report?.windowCount { row("上次检测窗口：\(count)") }
        if permission.trusted, report?.windows.contains(where: { $0.editableElementCount > 0 }) == true {
            row("输入区域：可读取，未做任何输入")
        }
        row("对话身份与入队确认：待专用测试验证")
        menu.addItem(.separator())
        row("重新检查连接", action: #selector(refresh))
        row("保存只读诊断…", action: #selector(saveReport))
        row("权限设置与引导…", action: #selector(showPermissionGuide))
        row(guideCopy.buttonTitle, action: #selector(openAccessibilitySettings))
        menu.addItem(.separator())
        row("退出助手", action: #selector(quit))
    }

    @objc private func openAccessibilitySettings() {
        // Explicit user click only. macOS, not the helper, grants permission.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        if !AXIsProcessTrusted() { _ = AXIsProcessTrustedWithOptions(options) }
        permission.settingsRequestedAt = Date()
        // true confirms URL dispatch only, not arrival at the requested Settings page
        // or a permission grant. Before authorization we cannot inspect Settings' UI.
        permission.settingsLaunchFailed = !NSWorkspace.shared.open(PermissionGuideCopy.settingsURL)
        renderPermissionGuide()
        if permission.settingsLaunchFailed { showPermissionGuide() }
    }

    func menuNeedsUpdate(_ menu: NSMenu) { checkPermission() }

    @objc private func checkPermission() {
        let trusted = AXIsProcessTrusted()
        guard trusted != permission.trusted else { return }
        permission.trusted = trusted
        if trusted { permission.settingsLaunchFailed = false }
        renderMenu()
        renderPermissionGuide()
    }

    private func label(_ text: String, font: NSFont = .systemFont(ofSize: 13), color: NSColor = .labelColor) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = font
        field.textColor = color
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }

    @objc private func showPermissionGuide() {
        if permissionWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 510, height: 360),
                styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "连接 Codex · 权限设置"
            window.isReleasedWhenClosed = false
            let stack = NSStackView()
            stack.orientation = .vertical
            stack.alignment = .leading
            stack.spacing = 16
            stack.translatesAutoresizingMaskIntoConstraints = false
            let title = label("允许助手操作 Codex", font: .boldSystemFont(ofSize: 20))
            let explanation = label("用于后续通过原生输入框提交需求。当前验证版不会自动输入或发送。", color: .secondaryLabelColor)
            let button = NSButton(title: guideCopy.buttonTitle, target: self, action: #selector(openAccessibilitySettings))
            button.bezelStyle = .rounded
            button.controlSize = .large
            let instructions = label(guideCopy.instructions)
            let stateLabel = label(permission.statusText)
            permissionStatusLabel = stateLabel
            stateLabel.setAccessibilityIdentifier("arkme-companion-permission-status")
            let notice = label("", color: .systemRed)
            permissionNoticeLabel = notice
            let fallback = label(guideCopy.fallback, font: .systemFont(ofSize: 12), color: .secondaryLabelColor)
            let reveal = NSButton(title: "找不到助手？在访达中定位", target: self, action: #selector(revealApplication))
            reveal.bezelStyle = .rounded
            for view in [title, explanation, button, instructions, stateLabel, notice, fallback, reveal] {
                stack.addArrangedSubview(view)
            }
            window.contentView!.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
                stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
                stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
                stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -24),
            ])
            for field in [title, explanation, instructions, stateLabel, notice, fallback] {
                field.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            }
            permissionWindow = window
            window.center()
        }
        checkPermission()
        renderPermissionGuide()
        permissionWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func renderPermissionGuide() {
        permissionStatusLabel?.stringValue = permission.statusText
        permissionStatusLabel?.textColor = permission.trusted ? .systemGreen : .secondaryLabelColor
        permissionNoticeLabel?.stringValue = permission.openingNotice ?? ""
        permissionNoticeLabel?.isHidden = permission.openingNotice == nil
        // Fit wrapped text and an optional error without truncating the fallback.
        if let window = permissionWindow, let stack = window.contentView?.subviews.first as? NSStackView {
            window.contentView?.layoutSubtreeIfNeeded()
            window.setContentSize(NSSize(width: 510, height: max(350, stack.fittingSize.height + 48)))
        }
    }

    @objc private func revealApplication() {
        NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
    }

    func applicationWillTerminate(_ notification: Notification) {
        permissionTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    @objc private func saveReport() {
        // A grant/revocation may have happened since the last full window probe.
        // The exported diagnostic must not contradict the live permission state.
        refresh()
        guard let report, let data = try? encodeReport(report) else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "arkme-codex-readonly-diagnostic.json"
        panel.title = "保存诊断（不含消息正文、标题或草稿）"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try data.write(to: url, options: .atomic) }
        catch {
            let alert = NSAlert()
            alert.messageText = "无法保存诊断"
            alert.informativeText = "请选择可写入的位置后重试。"
            alert.runModal()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["doctor"] {
    do {
        FileHandle.standardOutput.write(try encodeReport(doctor()))
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        FileHandle.standardError.write(Data("Unable to encode diagnostic result.\n".utf8))
        exit(1)
    }
} else if validNativeValidationArguments(arguments) {
    do { try runNativeValidation(arguments) }
    catch {
        // Adapter errors are fixed reason codes, never message text or clipboard contents.
        FileHandle.standardError.write(Data("Native validation stopped: \(error)\n".utf8))
        exit(1)
    }
} else if arguments.isEmpty {
    let application = NSApplication.shared
    let delegate = CompanionDelegate()
    application.delegate = delegate
    application.run()
    withExtendedLifetime(delegate) {}
} else {
    FileHandle.standardError.write(Data("Usage: ArkmeCodexCompanion [doctor]\nGUI is read-only. Native tests require the dedicated fixture arguments. No remote input is enabled.\n".utf8))
    exit(64)
}

import Foundation

struct PermissionGuideCopy {
    let systemMajorVersion: Int
    let appName: String

    // macOS 27 title verified in System Settings on this development machine.
    // The URL retains Apple's legacy accessibility anchor despite the new title.
    static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
    var pageTitle: String { systemMajorVersion >= 27 ? "设备控制和数据访问" : "辅助功能" }
    var settingsPath: String { "系统设置 → 隐私与安全 → \(pageTitle)" }
    var buttonTitle: String { "打开「\(pageTitle)」" }
    var instructions: String { "请在列表中开启 \(appName) 的开关。\n如需验证，请由你在系统窗口中完成。" }
    var fallback: String { "若没有直达：\(settingsPath)。\n若列表中没有助手，点击下方定位应用，再用权限页的「＋」添加。" }
}

struct PermissionGuideState {
    var trusted: Bool
    var settingsLaunchFailed = false
    var settingsRequestedAt: Date?

    var statusText: String { trusted ? "已授权 · 自动输入仍未开启" : "尚未授权 · 等待你开启权限" }
    var openingNotice: String? {
        settingsLaunchFailed ? "未能打开权限设置，请按下方路径进入。" : nil
    }
    // Returning from Settings is also observed separately. Timer checks are cheap
    // AXIsProcessTrusted reads, not whole-window scans or repeated permission prompts.
    func shouldPoll(guideVisible: Bool, now: Date) -> Bool {
        guideVisible || settingsRequestedAt.map { now.timeIntervalSince($0) >= 0 && now.timeIntervalSince($0) < 180 } == true
    }
}

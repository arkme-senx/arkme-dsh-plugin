import Foundation

var checks = 0
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
    checks += 1
}

let modern = PermissionGuideCopy(systemMajorVersion: 27, appName: "Arkme Codex Companion Preview.app")
let legacy = PermissionGuideCopy(systemMajorVersion: 26, appName: "Arkme Codex Companion Preview.app")
check(modern.pageTitle == "设备控制和数据访问", "Use the observed macOS 27 permission page name")
check(legacy.pageTitle == "辅助功能", "Keep legacy page naming")
check(modern.buttonTitle == "打开「设备控制和数据访问」", "Button names its exact target")
check(modern.settingsPath == "系统设置 → 隐私与安全 → 设备控制和数据访问", "Exact fallback path")
check(modern.instructions.contains(modern.appName), "Specify the app to authorize")
check(modern.fallback.contains("＋"), "Explain how to add a missing app")
check(PermissionGuideCopy.settingsURL.scheme == "x-apple.systempreferences", "Native settings URL only")
check(PermissionGuideCopy.settingsURL.query == "Privacy_Accessibility", "Do not fall back to privacy root")

let now = Date(timeIntervalSince1970: 1_000)
var state = PermissionGuideState(trusted: false)
check(state.statusText.contains("尚未授权"), "Initial state is unapproved")
check(state.openingNotice == nil, "No false error before user click")
check(!state.shouldPoll(guideVisible: false, now: now), "No permanent hidden timer work")
check(state.shouldPoll(guideVisible: true, now: now), "Visible guide stays current")
state.settingsRequestedAt = now
check(!state.trusted, "Dispatching Settings must not grant permission")
check(state.shouldPoll(guideVisible: false, now: now.addingTimeInterval(179)), "Watch after leaving for Settings")
check(!state.shouldPoll(guideVisible: false, now: now.addingTimeInterval(180)), "Bound background waiting")
check(!state.shouldPoll(guideVisible: false, now: now.addingTimeInterval(-1)), "Clock rollback must not extend waiting")
state.settingsLaunchFailed = true
check(state.openingNotice?.contains("未能打开") == true, "Provide explicit launch failure")
check(!state.trusted, "Failure never authorizes")
state.settingsLaunchFailed = false
check(state.openingNotice == nil, "Successful dispatch clears stale launch error")
state.trusted = true
check(state.statusText == "已授权 · 自动输入仍未开启", "Permission is not proof of dispatch readiness")
state.trusted = false
check(state.statusText.contains("尚未授权"), "Permission revocation updates the same state")

print("PASS: \(checks) permission guide and state checks; no system settings or permissions changed.")

import Foundation

var checks = 0
func check(_ result: Bool, _ label: String) {
    guard result else {
        FileHandle.standardError.write(Data("Native input policy failed: \(label)\n".utf8))
        exit(1)
    }
    checks += 1
}
check(NativeInputPolicy.validateText("保留正文\n  空格\t"), "multiline text")
check(!NativeInputPolicy.validateText(" \n\t"), "empty")
check(!NativeInputPolicy.validateText("hello\0world"), "control character")
check(!NativeInputPolicy.validateText(String(repeating: "中", count: 5500)), "utf8 bound")
check(NativeInputPolicy.validateText(String(repeating: "a", count: 16_384)), "exact boundary")
check(NativeInputPolicy.emptyEditor(value: "随心输入\n", description: "随心输入", childClasses: [["placeholder"]]), "native placeholder")
check(!NativeInputPolicy.emptyEditor(value: "随心输入\n", description: "随心输入", childClasses: [[]]), "user typed placeholder")
check(!NativeInputPolicy.emptyEditor(value: "draft", description: "随心输入", childClasses: [["placeholder"]]), "draft")
check(!NativeInputPolicy.emptyEditor(value: "随心输入\n", description: "随心输入", childClasses: [["placeholder"], []]), "extra content")
check(!NativeInputPolicy.emptyEditor(value: "", description: "", childClasses: []), "unknown empty structure")
let id = UUID(), valid = "codex://threads/\(id.uuidString.lowercased())"
check(NativeInputPolicy.target(from: valid) == id, "exact UUID deep link")
for bad in [valid + "?x=1", valid + "#fragment", valid + "/another", valid + "/", "https://example.test/\(id)",
            "codex://user@threads/\(id)", "codex://threads:123/\(id)", "codex://threads/not-a-uuid"] {
    check(NativeInputPolicy.target(from: bad) == nil, "reject noncanonical link")
}
check(NativeInputPolicy.submissionAction(titles: ["发送"], busy: false) == "发送", "idle sends")
check(NativeInputPolicy.submissionAction(titles: ["停止", "排队"], busy: true) == "排队", "busy queues")
check(NativeInputPolicy.submissionAction(titles: ["停止", "引导"], busy: true) == nil, "never steer")
check(NativeInputPolicy.submissionAction(titles: ["停止", "发送"], busy: true) == nil, "ambiguous busy send")
check(NativeInputPolicy.submissionAction(titles: ["发送", "排队"], busy: false) == nil, "ambiguous buttons")
check(NativeInputPolicy.submissionAction(titles: ["排队"], busy: false) == nil, "state changed")
check(!NativeInputPolicy.allowedComposerControl(role: "AXButton", title: "删除附件"), "attachment controls blocked")
check(!NativeInputPolicy.allowedComposerControl(role: "AXButton", title: "Remove file"), "unknown controls blocked")
check(NativeInputPolicy.allowedComposerControl(role: "AXButton", title: "添加文件等内容"), "observed empty composer")
check(!NativeInputPolicy.verifiedVersions.contains("future-version"), "version gate")
print("\(checks) native input policy checks passed; no native UI was accessed or changed.")

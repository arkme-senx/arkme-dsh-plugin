import Cocoa
import WebKit

private let nativeTitlebarHeight: CGFloat = 50

private final class WindowDragView: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

final class ArkmeDSHAppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 0, y: 0, width: 1360, height: 900)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Arkme"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .white
        window.minSize = NSSize(width: 1000, height: 680)
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('arkme-native-desktop')",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        let contentView = NSView(frame: frame)
        contentView.autoresizingMask = [.width, .height]
        let webView = WKWebView(frame: contentView.bounds, configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        contentView.addSubview(webView)
        let dragView = WindowDragView(frame: NSRect(
            x: 0,
            y: contentView.bounds.height - nativeTitlebarHeight,
            width: contentView.bounds.width,
            height: nativeTitlebarHeight
        ))
        dragView.autoresizingMask = [.width, .minYMargin]
        contentView.addSubview(dragView, positioned: .above, relativeTo: webView)
        window.contentView = contentView

        self.window = window
        self.webView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        loadClient()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showConnectionError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showConnectionError(error)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("document.documentElement.classList.add('arkme-native-desktop')")
    }

    private func loadClient() {
        let configuredURL = Bundle.main.object(forInfoDictionaryKey: "ArkmeDSHURL") as? String
        let address = configuredURL ?? "http://127.0.0.1:5187/"
        guard let url = URL(string: address) else { return }
        webView?.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private func showConnectionError(_ error: Error) {
        guard let window else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Arkme 本地服务暂时无法连接"
        alert.informativeText = "请确认本地 DSH 服务已经启动，然后点击重试。\n\n\(error.localizedDescription)"
        alert.addButton(withTitle: "重试")
        alert.addButton(withTitle: "退出")
        alert.beginSheetModal(for: window) { [weak self] response in
            if response == .alertFirstButtonReturn {
                self?.loadClient()
            } else {
                NSApp.terminate(nil)
            }
        }
    }
}

let application = NSApplication.shared
let applicationDelegate = ArkmeDSHAppDelegate()
application.setActivationPolicy(.regular)
application.delegate = applicationDelegate
application.run()

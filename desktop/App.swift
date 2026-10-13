import AppKit
import WebKit
import Security
import AuthenticationServices

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, ASWebAuthenticationPresentationContextProviding {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serviceLabel: NSTextField!
    private var loading: NSProgressIndicator!
    private var process: Process?
    private var baseURL: URL?
    private var profileDir: URL?
    private var bootstrap = ""
    private var desktopAuthSecret = ""
    private var authSession: ASWebAuthenticationSession?
    private var authFlowId: String?
    private var authStarting = false
    private let nativeHTTP = URLSession(configuration: .ephemeral)
    private var generation = 0
    private var quitting = false
    private var intentionalStop = false
    private let ioQueue = DispatchQueue(label: "cn.mosi.switchboard.io")
    private var output = Data()
    private var logHandle: FileHandle?
    private var pendingStop: (() -> Void)?
    private var supportDir: URL {
        if let index = CommandLine.arguments.firstIndex(of: "--support-dir"), CommandLine.arguments.count > index + 1 {
            return URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true)
        }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Switchboard", isDirectory: true)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let other = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "cn.mosi.switchboard.desktop").first(where: { $0.processIdentifier != getpid() }) {
            other.activate(options: [.activateAllWindows]); NSApp.terminate(nil); return
        }
        NSApp.setActivationPolicy(.regular)
        makeMenu(); makeWindow(); startService()
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        // This link only opens a view. No credentials or platform sessions are
        // accepted from deep links; OAuth completes on the loopback server.
        guard urls.contains(where: { $0.scheme == "switchboard" && $0.host == "subscription-connected" }),
              let origin = baseURL, webView != nil else { return }
        guard let destination = URL(string: origin.absoluteString + "/#providers") else { return }
        webView.load(URLRequest(url: destination))
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    private func makeMenu() {
        let main = NSMenu(); NSApp.mainMenu = main
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(title: "Switchboard"); appItem.submenu = appMenu
        add(appMenu, "关于 Switchboard", #selector(about), "")
        appMenu.addItem(.separator())
        add(appMenu, "导入已有部署…", #selector(importData), "i")
        add(appMenu, "打开数据目录", #selector(openData), "")
        add(appMenu, "飞书登录配置说明", #selector(feishuHelp), "")
        add(appMenu, "重启本机服务", #selector(restart), "")
        appMenu.addItem(.separator())
        add(appMenu, "隐藏 Switchboard", #selector(NSApplication.hide(_:)), "h", target: NSApp)
        appMenu.addItem(.separator())
        add(appMenu, "退出 Switchboard", #selector(NSApplication.terminate(_:)), "q", target: NSApp)
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "编辑"); editItem.submenu = edit
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "显示"); viewItem.submenu = view
        add(view, "刷新页面", #selector(reload), "r")
        add(view, "在浏览器中打开", #selector(openBrowser), "")
        add(view, "放大", #selector(zoomIn), "+")
        add(view, "缩小", #selector(zoomOut), "-")
        add(view, "实际大小", #selector(zoomReset), "0")
        let windowItem = NSMenuItem(); main.addItem(windowItem)
        let windows = NSMenu(title: "窗口"); windowItem.submenu = windows; NSApp.windowsMenu = windows
        add(windows, "最小化", #selector(NSWindow.performMiniaturize(_:)), "m", target: nil)
    }
    private func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String, target: AnyObject? = nil) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = target ?? (action == #selector(NSWindow.performMiniaturize(_:)) ? nil : self); menu.addItem(item)
    }
    private func makeWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Switchboard · 模思智能"; window.minSize = NSSize(width: 820, height: 560)
        window.isReleasedWhenClosed = false; window.setFrameAutosaveName("SwitchboardMain"); window.center()
        let root = NSView(); window.contentView = root
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "SwitchboardDesktop"
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self; webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        let toolbar = NSVisualEffectView(); toolbar.material = .headerView; toolbar.blendingMode = .withinWindow
        serviceLabel = NSTextField(labelWithString: "正在启动本机工作空间…")
        serviceLabel.font = .systemFont(ofSize: 12); serviceLabel.textColor = .secondaryLabelColor
        serviceLabel.lineBreakMode = .byTruncatingMiddle
        let actions = NSStackView(); actions.orientation = .horizontal; actions.spacing = 8
        for (title, action) in [("导入已有部署…", #selector(importData)), ("浏览器打开", #selector(openBrowser)), ("刷新", #selector(reload))] {
            let button = NSButton(title: title, target: self, action: action); button.bezelStyle = .rounded; actions.addArrangedSubview(button)
        }
        loading = NSProgressIndicator(); loading.style = .spinning; loading.controlSize = .large; loading.isDisplayedWhenStopped = false
        for view in [webView!, toolbar, loading!] { view.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(view) }
        for view in [serviceLabel!, actions] { view.translatesAutoresizingMaskIntoConstraints = false; toolbar.addSubview(view) }
        serviceLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: root.topAnchor), toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor), toolbar.heightAnchor.constraint(equalToConstant: 46),
            serviceLabel.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 16), serviceLabel.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor), serviceLabel.trailingAnchor.constraint(lessThanOrEqualTo: actions.leadingAnchor, constant: -12),
            actions.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -12), actions.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor), webView.leadingAnchor.constraint(equalTo: root.leadingAnchor), webView.trailingAnchor.constraint(equalTo: root.trailingAnchor), webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            loading.centerXAnchor.constraint(equalTo: webView.centerXAnchor), loading.centerYAnchor.constraint(equalTo: webView.centerYAnchor)
        ])
        window.makeKeyAndOrderFront(nil)
    }

    private func startService(importFrom: URL? = nil) {
        generation += 1; let current = generation
        intentionalStop = false; baseURL = nil; ioQueue.sync { output = Data() }
        webView.configuration.userContentController.removeAllUserScripts()
        serviceLabel.stringValue = importFrom == nil ? "正在启动本机工作空间…" : "正在复制并校验原部署数据…"
        loading.startAnimation(nil)
        do {
            try FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let logURL = supportDir.appendingPathComponent("desktop.log")
            if let attributes = try? FileManager.default.attributesOfItem(atPath: logURL.path), let size = attributes[.size] as? NSNumber, size.intValue > 1_048_576 { try? FileManager.default.removeItem(at: logURL) }
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
            logHandle = try FileHandle(forWritingTo: logURL); logHandle?.seekToEndOfFile()
            guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "Switchboard", code: 1) }
            let child = Process(); child.executableURL = resources.appendingPathComponent("runtime/node")
            child.arguments = [resources.appendingPathComponent("server/desktop/runtime.mjs").path]
            child.currentDirectoryURL = supportDir
            var environment = ProcessInfo.processInfo.environment
            environment.removeValue(forKey: "NODE_OPTIONS"); environment.removeValue(forKey: "NODE_PATH")
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NSError(domain: "Switchboard", code: 2) }
            bootstrap = bytes.map { String(format: "%02x", $0) }.joined()
            desktopAuthSecret = bootstrap
            environment["SWITCHBOARD_DESKTOP_SUPPORT_DIR"] = supportDir.path
            environment["SWITCHBOARD_DESKTOP_BOOTSTRAP"] = bootstrap
            environment["SWITCHBOARD_DESKTOP_PORT"] = "3110"
            environment.removeValue(forKey: "SWITCHBOARD_DESKTOP_IMPORT")
            if let source = importFrom { environment["SWITCHBOARD_DESKTOP_IMPORT"] = source.path }
            child.environment = environment
            let stdout = Pipe(), stderr = Pipe(); child.standardOutput = stdout; child.standardError = stderr
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData; if data.isEmpty { return }
                self?.ioQueue.async { self?.readOutput(data, generation: current) }
            }
            stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData; if data.isEmpty { return }
                self?.ioQueue.async { try? self?.logHandle?.write(contentsOf: data) }
            }
            child.terminationHandler = { [weak self] _ in
                stdout.fileHandleForReading.readabilityHandler = nil; stderr.fileHandleForReading.readabilityHandler = nil
                DispatchQueue.main.async { self?.serviceExited(generation: current) }
            }
            process = child; try child.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 45) { [weak self] in
                guard let self = self, self.generation == current, self.baseURL == nil, self.process?.isRunning == true else { return }
                self.stopService { self.startupFailed("本机服务启动超时。可重试启动，或导入完整的数据备份。") }
            }
        } catch { startupFailed("无法启动内置运行环境。请将完整的 Switchboard.app 拖入“应用程序”后重新打开。") }
    }
    private func readOutput(_ data: Data, generation current: Int) {
        output.append(data)
        while let newline = output.firstIndex(of: 10) {
            let line = output.prefix(upTo: newline); output.removeSubrange(...newline)
            guard let event = try? JSONSerialization.jsonObject(with: line) as? [String: Any], event["event"] as? String == "desktop-ready", let text = event["url"] as? String, let url = URL(string: text), url.host == "127.0.0.1" else { continue }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.generation == current, !self.intentionalStop else { return }
                self.baseURL = url
                if let profile = event["profileDir"] as? String { self.profileDir = URL(fileURLWithPath: profile, isDirectory: true) }
                if event["needsSetup"] as? Bool == true { self.installBootstrap(for: url) }
                self.bootstrap = ""
                self.serviceLabel.stringValue = "本机 API · \(text)/v1"
                self.webView.load(URLRequest(url: url))
            }
        }
    }
    private func installBootstrap(for url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["token": bootstrap, "origin": url.absoluteString]), let value = String(data: data, encoding: .utf8) else { return }
        let script = """
        (() => {
          const config = \(value); if (location.origin !== config.origin) return;
          const fill = () => {
            const input = document.querySelector('#account-login input[name="bootstrapToken"]');
            if (!input) return; input.value = config.token; input.closest('label').hidden = true;
            const hint = document.querySelector('#account-login > p');
            const text = '设置姓名、邮箱与密码，开始使用本机工作空间。密码至少 12 个字符。';
            if (hint && hint.textContent !== text) hint.textContent = text;
          };
          new MutationObserver(fill).observe(document.documentElement, {childList:true,subtree:true}); fill();
        })();
        """
        webView.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }
    private func serviceExited(generation current: Int) {
        guard generation == current else { return }
        process = nil
        if quitting { NSApp.reply(toApplicationShouldTerminate: true); return }
        if let completion = pendingStop { pendingStop = nil; completion(); return }
        if !intentionalStop { startupFailed("本机服务已停止。请点击“重试”；若刚导入数据，原桌面工作空间仍保留，可重新启动恢复。") }
    }
    private func stopService(_ completion: @escaping () -> Void) {
        cancelAuthentication()
        intentionalStop = true; baseURL = nil
        guard let child = process, child.isRunning else { completion(); return }
        pendingStop = completion; child.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { if child.isRunning { kill(child.processIdentifier, SIGKILL) } }
    }
    private func startupFailed(_ message: String) {
        loading.stopAnimation(nil); serviceLabel.stringValue = "本机服务未运行"
        let alert = NSAlert(); alert.messageText = "无法打开工作空间"; alert.informativeText = message
        alert.addButton(withTitle: "重试"); alert.addButton(withTitle: "打开数据目录"); alert.addButton(withTitle: "关闭")
        alert.beginSheetModal(for: window) { [weak self] result in
            if result == .alertFirstButtonReturn { self?.stopService { self?.startService() } }
            else if result == .alertSecondButtonReturn { self?.openData() }
        }
    }

    @objc private func importData() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.title = "导入已有 Switchboard 部署"; panel.prompt = "导入独立副本"
        panel.message = "选择同时包含 .env 与 data 的部署目录。导入会保留原数据；建议先停止原服务以保持配置与历史记录一致。"
        panel.beginSheetModal(for: window) { [weak self] result in
            guard result == .OK, let source = panel.url, let self = self else { return }
            guard FileManager.default.fileExists(atPath: source.appendingPathComponent(".env").path), FileManager.default.fileExists(atPath: source.appendingPathComponent("data").path) else {
                let alert = NSAlert(); alert.messageText = "目录不完整"; alert.informativeText = "请选择同时包含 .env 和 data 的原部署目录。"; alert.beginSheetModal(for: self.window); return
            }
            self.stopService { self.startService(importFrom: source) }
        }
    }
    @objc private func openData() { NSWorkspace.shared.open(profileDir ?? supportDir) }
    @objc private func openBrowser() { if let url = baseURL { NSWorkspace.shared.open(url) } }
    @objc private func reload() { if baseURL != nil { webView.reload() } }
    @objc private func restart() { stopService { self.startService() } }
    @objc private func zoomIn() { webView.pageZoom = min(1.8, webView.pageZoom + 0.1) }
    @objc private func zoomOut() { webView.pageZoom = max(0.7, webView.pageZoom - 0.1) }
    @objc private func zoomReset() { webView.pageZoom = 1 }
    @objc private func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Switchboard · 模思智能", .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", .credits: NSAttributedString(string: "本机 AI 路由工作空间\n内置运行环境 · 数据保存在本机")]) }
    @objc private func feishuHelp() {
        let address = (baseURL?.absoluteString ?? "http://127.0.0.1:3110") + "/api/account/sso/feishu/callback"
        let alert = NSAlert(); alert.messageText = "桌面版飞书登录"
        alert.informativeText = "登录使用系统浏览器授权，完成后自动回到 App。飞书可能要求扫码或确认授权。\n\n每个企业的飞书应用都需在“安全设置 → 重定向 URL”新增以下地址，保留原部署地址：\n\n\(address)\n\n若端口被占用，应关闭占用 3110 的程序并重启 App，或在飞书后台登记界面显示的实际回调地址。无需重新填写 App Secret。"
        alert.addButton(withTitle: "复制回调地址"); alert.addButton(withTitle: "关闭")
        alert.beginSheetModal(for: window) { result in
            if result == .alertFirstButtonReturn { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(address, forType: .string) }
        }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { window }
    private func authenticationError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "飞书登录未完成"; alert.informativeText = message
        alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "配置说明")
        alert.beginSheetModal(for: window) { [weak self] result in if result == .alertSecondButtonReturn { self?.feishuHelp() } }
    }
    private func nativeRequest(_ route: String, payload: [String: Any], completion: @escaping ([String: Any]?, HTTPURLResponse?, String?) -> Void) {
        guard let base = baseURL, let url = URL(string: "/api/account/sso/feishu/desktop/" + route, relativeTo: base)?.absoluteURL else { return }
        let current = generation
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(desktopAuthSecret, forHTTPHeaderField: "X-Switchboard-Desktop")
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        nativeHTTP.dataTask(with: request) { [weak self] data, response, error in
            let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let http = response as? HTTPURLResponse
            let ok = http.map { (200..<300).contains($0.statusCode) } ?? false
            let message = (object?["error"] as? [String: Any])?["message"] as? String
            DispatchQueue.main.async {
                guard let self = self, self.generation == current, !self.quitting else { return }
                completion(ok ? object : nil, http, ok ? nil : (message ?? (error == nil ? "桌面登录响应异常，请重试。" : "无法连接本机服务，请重启 App。")))
            }
        }.resume()
    }
    private func cancelAuthentication() {
        let id = authFlowId; authFlowId = nil; authStarting = false
        authSession?.cancel(); authSession = nil
        if let id = id { nativeRequest("cancel", payload: ["id": id]) { _, _, _ in } }
    }
    private func startFeishuLogin(provider: String?) {
        guard !authStarting else { return }; cancelAuthentication(); authStarting = true
        nativeRequest("start", payload: ["provider": provider ?? ""]) { [weak self] object, _, error in
            guard let self = self else { return }; self.authStarting = false
            guard let object = object, let id = object["id"] as? String, let text = object["url"] as? String, let url = URL(string: text) else { self.authenticationError(error ?? "无法发起飞书登录。"); return }
            self.beginAuthentication(url: url, id: id)
        }
    }
    private func beginAuthentication(url: URL, id: String) {
        guard url.scheme == baseURL?.scheme, url.host == baseURL?.host, url.port == baseURL?.port else { return }
        cancelAuthentication(); authFlowId = id
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "switchboard") { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self = self, self.authFlowId == id else { return }; self.authSession = nil
                guard let callback = callback, callback.scheme == "switchboard", callback.host == "feishu-login",
                      let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value else {
                    self.cancelAuthentication()
                    if let error = error, (error as NSError).code != ASWebAuthenticationSessionError.canceledLogin.rawValue { self.authenticationError("无法打开系统授权窗口。请检查默认浏览器，或重新发起登录。"); }
                    NSApp.activate(ignoringOtherApps: true); return
                }
                self.nativeRequest("complete", payload: ["id": id, "code": code]) { [weak self] object, response, failure in
                    guard let self = self, self.authFlowId == id else { return }
                    guard let object = object, let path = object["path"] as? String, ["/#overview", "/#account"].contains(path), let base = self.baseURL else {
                        self.cancelAuthentication(); self.authenticationError(failure ?? "登录结果已失效，请重试。"); return
                    }
                    self.authFlowId = nil
                    let headers = response?.allHeaderFields.reduce(into: [String: String]()) { result, item in if let key = item.key as? String, let value = item.value as? String { result[key] = value } } ?? [:]
                    let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: base).filter { $0.name == "sr_session" }
                    let group = DispatchGroup()
                    for cookie in cookies { group.enter(); self.webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() } }
                    let current = self.generation
                    group.notify(queue: .main) {
                        guard self.generation == current, !self.quitting, let destination = URL(string: path, relativeTo: base)?.absoluteURL else { return }
                        self.webView.load(URLRequest(url: destination)); self.window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
                    }
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() { cancelAuthentication(); authenticationError("系统无法启动飞书授权窗口，请检查默认浏览器并重试。") }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        cancelAuthentication()
        guard let child = process, child.isRunning else { return .terminateNow }
        quitting = true; intentionalStop = true; child.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { if child.isRunning { kill(child.processIdentifier, SIGKILL) }; NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading.stopAnimation(nil) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        if url.scheme == "blob" || url.scheme == "about" { decisionHandler(.allow); return }
        if url.scheme == baseURL?.scheme && url.host == baseURL?.host && url.port == baseURL?.port {
            if navigationAction.targetFrame?.isMainFrame != false && url.path == "/api/account/chatgpt/authorize" {
                decisionHandler(.cancel)
                NSWorkspace.shared.open(url, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
                    guard error != nil else { return }
                    DispatchQueue.main.async {
                        guard let self = self else { return }
                        let alert = NSAlert(); alert.messageText = "无法打开系统浏览器"
                        alert.informativeText = "请设置默认浏览器，再点击“重新打开授权”。原有订阅连接不受影响。"
                        alert.beginSheetModal(for: self.window)
                    }
                }; return
            }
            if navigationAction.targetFrame?.isMainFrame != false && url.path == "/api/account/sso/feishu/start" {
                decisionHandler(.cancel)
                let provider = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "provider" })?.value
                startFeishuLogin(provider: provider); return
            }
            if navigationAction.targetFrame?.isMainFrame != false && url.path == "/api/account/sso/feishu/desktop/authorize",
               let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "id" })?.value {
                decisionHandler(.cancel); beginAuthentication(url: url, id: id); return
            }
            decisionHandler(.allow); return
        }
        if let host = url.host, (host == "feishu.cn" || host.hasSuffix(".feishu.cn")), url.scheme == "https" { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }; return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.canChooseDirectories = parameters.allowsDirectories; panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24)); field.stringValue = defaultText ?? ""; alert.accessoryView = field
        alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()

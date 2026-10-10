import AppKit
import WebKit
final class IconRenderer: NSObject, WKNavigationDelegate {
    var webView: WKWebView!
    func run() {
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 1024)); webView.navigationDelegate = self
        let source = (try? String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)) ?? ""
        let svg = source.replacingOccurrences(of: "#2C251E", with: "#69dceb", options: .caseInsensitive)
        webView.loadHTMLString("<html><style>html,body{margin:0;width:1024px;height:1024px;background:transparent}.icon{position:absolute;inset:58px;border-radius:196px;background:linear-gradient(145deg,#132937,#081722);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 3px #3b6f80}svg{width:660px;height:660px}</style><div class='icon'>\(svg)</div></html>", baseURL: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let config = WKSnapshotConfiguration(); config.rect = webView.bounds; config.snapshotWidth = 1024
        webView.takeSnapshot(with: config) { image, error in
            guard let image = image, let tiff = image.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiff), let pixels = bitmap.cgImage,
                  let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
            // WK snapshots can flatten a transparent page onto white. Keep the
            // macOS icon silhouette transparent rather than a white Dock square.
            context.addPath(CGPath(roundedRect: CGRect(x: 58, y: 58, width: 908, height: 908), cornerWidth: 196, cornerHeight: 196, transform: nil))
            context.clip(); context.draw(pixels, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
            guard let clipped = context.makeImage(), let png = NSBitmapImageRep(cgImage: clipped).representation(using: .png, properties: [:]) else { exit(1) }
            do { try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2])); exit(0) } catch { exit(1) }
        }
    }
}
let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
let renderer = IconRenderer(); renderer.run()
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { exit(1) }
app.run()

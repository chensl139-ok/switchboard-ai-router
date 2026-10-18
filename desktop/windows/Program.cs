using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Switchboard.Desktop
{
    internal static class Program
    {
        internal static JavaScriptSerializer Json => new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
        internal static string SupportDir;
        internal static bool Smoke;
        private static int exitCode;

        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            // A registered URI is a single argument, never a source of flags or
            // filesystem paths. Validate the complete shape before touching ACLs.
            string activation = null;
            string customSupport = null;
            if (args.Any(a => a.StartsWith("switchboard:", StringComparison.OrdinalIgnoreCase)))
            { if (args.Length != 1 || !ValidActivation(args[0])) return 2; activation = args[0]; }
            else
            {
                for (var i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--smoke-test" && !Smoke) Smoke = true;
                    else if (args[i] == "--support-dir" && customSupport == null && i + 1 < args.Length && !args[i + 1].StartsWith("--")) customSupport = args[++i];
                    else return 2;
                }
            }
            try { SupportDir = Path.GetFullPath(customSupport ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Switchboard")); }
            catch { return 2; }
            // Smoke tests may never start against the user's real workspace.
            if (Smoke && (customSupport == null || File.Exists(Path.Combine(SupportDir, "active-profile.json")))) return 2;
            if (SupportDir.TrimEnd(Path.DirectorySeparatorChar).Equals(Path.GetPathRoot(SupportDir).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
                SupportDir.Equals(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), StringComparison.OrdinalIgnoreCase) ||
                SupportDir.Equals(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), StringComparison.OrdinalIgnoreCase)) return 2;
            try
            {
                Directory.CreateDirectory(SupportDir);
                var directoryAcl = new DirectorySecurity();
                directoryAcl.SetAccessRuleProtection(true, false);
                directoryAcl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,
                    FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
                Directory.SetAccessControl(SupportDir, directoryAcl);
                using (var single = new SingleInstance(SupportDir))
                {
                    if (!single.IsFirst) { single.Forward(activation ?? "focus"); return 0; }
                    foreach (var key in new[] { "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE" })
                        Environment.SetEnvironmentVariable(key, null);
                    try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                    catch (WebView2RuntimeNotFoundException)
                    {
                        SmokeResult(false, false, false, "webview2-runtime-missing");
                        if (!Smoke && MessageBox.Show("需要 Microsoft Edge WebView2 Runtime 才能打开工作空间。\n\n是否打开微软官方下载页？安装后重新启动 Switchboard。", "安装运行环境", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                            OpenWeb("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
                        return 1;
                    }
                    using (var window = new WorkspaceForm())
                    {
                        single.Activation += text => window.PostActivation(text);
                        single.Listen();
                        if (activation != null) window.Shown += (s, e) => window.PostActivation(activation);
                        Application.Run(window);
                    }
                }
            }
            catch
            {
                SmokeResult(false, false, false, "desktop-start-failed");
                if (!Smoke) MessageBox.Show("无法启动 Switchboard。请检查安装是否完整、数据目录是否可写，或重新安装。\n\n已有账号与数据不会被删除。", "Switchboard", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            return exitCode;
        }

        internal static void SmokeResult(bool ok, bool serviceReady, bool pageLoaded, string reason)
        {
            if (!Smoke) return;
            exitCode = ok ? 0 : 1;
            try { File.WriteAllText(Path.Combine(SupportDir, "smoke-result.json"), Json.Serialize(new { ok, serviceReady, pageLoaded, reason }), new UTF8Encoding(false)); } catch { }
        }

        internal static bool ValidActivation(string text)
        {
            if (text == "focus") return true;
            if (text == null || text.Length > 2048 || !Uri.TryCreate(text, UriKind.Absolute, out var uri) ||
                uri.Scheme != "switchboard" || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 ||
                !string.IsNullOrEmpty(uri.AbsolutePath.Trim('/'))) return false;
            if (uri.Host == "subscription-connected") return string.IsNullOrEmpty(uri.Query);
            return uri.Host == "feishu-login" && Regex.IsMatch(uri.Query, @"^\?code=[a-f0-9]{64}$");
        }

        internal static void OpenWeb(string address)
        {
            if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo.Length != 0) return;
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
    }

    // The pipe cannot be reached by another Windows account or a remote network
    // client. Its input is restricted to focus and two validated callback forms.
    internal sealed class SingleInstance : IDisposable
    {
        private readonly Mutex mutex;
        private readonly string pipeName;
        private volatile bool stopping;
        private NamedPipeServerStream listener;
        public bool IsFirst { get; }
        public event Action<string> Activation;

        public SingleInstance(string support)
        {
            var sid = WindowsIdentity.GetCurrent().User;
            using (var hash = SHA256.Create())
                pipeName = "Switchboard-" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(sid.Value + support.ToUpperInvariant()))).Replace("-", "").Substring(0, 32);
            var security = new MutexSecurity();
            security.AddAccessRule(new MutexAccessRule(sid, MutexRights.FullControl, AccessControlType.Allow));
            mutex = new Mutex(true, @"Local\" + pipeName, out var first, security);
            IsFirst = first;
        }

        public void Forward(string text)
        {
            if (!Program.ValidActivation(text)) return;
            try
            {
                using (var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.None, TokenImpersonationLevel.Identification))
                {
                    client.Connect(4000);
                    var bytes = Encoding.UTF8.GetBytes(text + "\n");
                    client.Write(bytes, 0, bytes.Length);
                }
            }
            catch { }
        }

        public void Listen()
        {
            Task.Run(async () =>
            {
                while (!stopping)
                {
                    try
                    {
                        var security = new PipeSecurity();
                        security.SetAccessRuleProtection(true, false);
                        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
                        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                        using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security))
                        {
                            listener = pipe;
                            await pipe.WaitForConnectionAsync();
                            using (var deadline = new CancellationTokenSource(4000))
                            using (var buffer = new MemoryStream())
                            {
                                var bytes = new byte[256];
                                while (buffer.Length <= 2048)
                                {
                                    var read = await pipe.ReadAsync(bytes, 0, bytes.Length, deadline.Token);
                                    if (read == 0) break;
                                    buffer.Write(bytes, 0, read);
                                    if (Array.IndexOf(bytes, (byte)'\n', 0, read) >= 0) break;
                                }
                                var text = Encoding.UTF8.GetString(buffer.ToArray()).TrimEnd('\r', '\n');
                                if (Program.ValidActivation(text)) Activation?.Invoke(text);
                            }
                        }
                    }
                    catch { if (!stopping) await Task.Delay(200); }
                }
            });
        }

        public void Dispose()
        {
            stopping = true;
            listener?.Dispose();
            if (IsFirst) mutex.ReleaseMutex();
            mutex.Dispose();
        }
    }

    internal sealed class WorkspaceForm : Form
    {
        private readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        private readonly ToolStripLabel status = new ToolStripLabel("正在启动本机工作空间…");
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly ToolStripMenuItem cancelLogin = new ToolStripMenuItem("取消飞书登录") { Enabled = false };
        private readonly HttpClient http = new HttpClient(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(20) };
        private Process child;
        private Uri origin;
        private string profileDir;
        private string authSecret = "";
        private string bootstrapScript;
        private string flowId;
        private bool authStarting;
        private bool authCompleting;
        private bool stopping;
        private bool restarting;
        private bool smokeChecking;
        private bool quitting;
        private bool exited;
        private int generation;
        private DateTime flowExpires;
        private readonly System.Windows.Forms.Timer authTimer = new System.Windows.Forms.Timer { Interval = 30000 };
        private readonly object logGate = new object();
        private TaskCompletionSource<Dictionary<string, object>> ready;
        private Task stopTask;

        internal WorkspaceForm()
        {
            Text = "Switchboard · 模思智能";
            Size = new Size(1280, 840);
            MinimumSize = new Size(820, 560);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            AutoScaleMode = AutoScaleMode.Dpi;
            var menu = MakeMenu();
            var bar = new ToolStrip { GripStyle = ToolStripGripStyle.Hidden, Padding = new Padding(8, 0, 8, 0), RenderMode = ToolStripRenderMode.System };
            bar.Items.Add(status);
            foreach (var item in new[] { new ToolStripButton("刷新", null, (s, e) => Reload()), new ToolStripButton("浏览器打开", null, (s, e) => OpenBrowser()), new ToolStripButton("复制 API", null, (s, e) => CopyApi()) })
            { item.Alignment = ToolStripItemAlignment.Right; bar.Items.Add(item); }
            Controls.Add(web); Controls.Add(bar); Controls.Add(menu);
            MainMenuStrip = menu;
            var trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("打开 Switchboard", null, (s, e) => BringForward());
            trayMenu.Items.Add("模型实验室", null, (s, e) => ShowPage("playground"));
            trayMenu.Items.Add("路由策略", null, (s, e) => ShowPage("routing"));
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("复制本机 API 地址", null, (s, e) => CopyApi());
            trayMenu.Items.Add("在浏览器中打开", null, (s, e) => OpenBrowser());
            trayMenu.Items.Add("退出 Switchboard", null, async (s, e) => await QuitAsync());
            tray.Icon = Icon; tray.Text = "Switchboard"; tray.ContextMenuStrip = trayMenu; tray.Visible = !Program.Smoke;
            tray.DoubleClick += (s, e) => BringForward();
            Shown += async (s, e) => await InitializeAsync();
            FormClosing += OnClosing;
            authTimer.Tick += async (s, e) => { if (flowId != null && DateTime.UtcNow > flowExpires) await CancelAuthenticationAsync(); };
            authTimer.Start();
        }

        private MenuStrip MakeMenu()
        {
            var menu = new MenuStrip();
            var app = new ToolStripMenuItem("Switchboard");
            app.DropDownItems.Add("关于 Switchboard", null, (s, e) => MessageBox.Show(this, "Switchboard " + Application.ProductVersion.Split('+')[0] + "\n本机 AI 路由工作空间\n账号、密钥和历史记录保存在本机。", "关于 Switchboard"));
            app.DropDownItems.Add("导入已有部署…", null, async (s, e) => await ImportAsync());
            app.DropDownItems.Add("打开数据目录", null, (s, e) => OpenData());
            app.DropDownItems.Add("飞书登录配置说明", null, (s, e) => FeishuHelp());
            cancelLogin.Click += async (s, e) => await CancelAuthenticationAsync();
            app.DropDownItems.Add(cancelLogin);
            app.DropDownItems.Add("重启本机服务", null, async (s, e) => await RestartAsync());
            app.DropDownItems.Add(new ToolStripSeparator());
            var quit = new ToolStripMenuItem("退出 Switchboard", null, async (s, e) => await QuitAsync()) { ShortcutKeys = Keys.Control | Keys.Q };
            app.DropDownItems.Add(quit);
            var view = new ToolStripMenuItem("显示");
            AddMenu(view, "打开工作空间", Keys.Control | Keys.D1, () => ShowPage("overview"));
            AddMenu(view, "模型实验室", Keys.Control | Keys.D2, () => ShowPage("playground"));
            AddMenu(view, "路由策略", Keys.Control | Keys.D3, () => ShowPage("routing"));
            AddMenu(view, "服务商与模型", Keys.Control | Keys.D4, () => ShowPage("providers"));
            view.DropDownItems.Add(new ToolStripSeparator());
            AddMenu(view, "刷新页面", Keys.Control | Keys.R, Reload);
            AddMenu(view, "放大", Keys.Control | Keys.Oemplus, () => web.ZoomFactor = Math.Min(1.8, web.ZoomFactor + .1));
            AddMenu(view, "缩小", Keys.Control | Keys.OemMinus, () => web.ZoomFactor = Math.Max(.7, web.ZoomFactor - .1));
            AddMenu(view, "实际大小", Keys.Control | Keys.D0, () => web.ZoomFactor = 1);
            menu.Items.Add(app); menu.Items.Add(view);
            return menu;
        }

        private static void AddMenu(ToolStripMenuItem parent, string title, Keys keys, Action action)
        { parent.DropDownItems.Add(new ToolStripMenuItem(title, null, (s, e) => action()) { ShortcutKeys = keys }); }

        private async Task InitializeAsync()
        {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.SupportDir, "WebView2"));
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Settings.UserAgent += " SwitchboardDesktop";
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                web.CoreWebView2.Settings.IsWebMessageEnabled = false;
                web.CoreWebView2.NavigationStarting += NavigationStarting;
                web.CoreWebView2.FrameNavigationStarting += (s, e) => { if (!IsLocal(e.Uri) && e.Uri != "about:blank") e.Cancel = true; };
                web.CoreWebView2.NewWindowRequested += async (s, e) =>
                {
                    e.Handled = true;
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
                    if (IsLocal(uri) && await HandleLocalAuthAsync(uri)) return;
                    if (IsLocal(uri)) web.CoreWebView2.Navigate(uri.AbsoluteUri);
                    else if (e.IsUserInitiated) TryOpenBrowser(uri.AbsoluteUri);
                };
                web.CoreWebView2.PermissionRequested += (s, e) => e.State = CoreWebView2PermissionState.Deny;
                web.CoreWebView2.ProcessFailed += (s, e) => SetStatus("页面进程已停止，可点击刷新恢复");
                web.CoreWebView2.NavigationCompleted += async (s, e) =>
                {
                    if (!Program.Smoke || smokeChecking || origin == null || !IsLocal(web.Source)) return;
                    smokeChecking = true;
                    try
                    {
                        if (!e.IsSuccess) { await SmokeFinishAsync(false, false, "page-navigation-failed"); return; }
                        var rendered = false;
                        for (var attempt = 0; attempt < 50 && !quitting; attempt++)
                        {
                            // A static HTML container is insufficient: require the
                            // initialized setup form and native bootstrap. Only a
                            // boolean crosses this check, never the token value.
                            var result = await web.CoreWebView2.ExecuteScriptAsync(@"(() => {
                              const form=document.querySelector('#account-login');
                              const token=form?.querySelector('input[name=bootstrapToken]');
                              const box=form?.getBoundingClientRect();
                              return Boolean(form?.closest('dialog')?.open && box?.width>0 && box?.height>0 &&
                                getComputedStyle(form).visibility!=='hidden' &&
                                form.querySelector('input[name=email][type=email]') && form.querySelector('input[name=password][type=password]') &&
                                token && /^[a-f0-9]{64}$/.test(token.value) && token.closest('label')?.hidden);
                            })()");
                            if (result == "true") { rendered = true; break; }
                            await Task.Delay(200);
                        }
                        if (rendered)
                        {
                            await web.CoreWebView2.ExecuteScriptAsync("window.__switchboardSmokePainted=false; document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__switchboardSmokePainted=true;})));");
                            rendered = false;
                            for (var attempt = 0; attempt < 30 && !quitting; attempt++)
                            {
                                await Task.Delay(100);
                                if (await web.CoreWebView2.ExecuteScriptAsync("window.__switchboardSmokePainted===true") == "true") { rendered = true; break; }
                            }
                        }
                        await SmokeFinishAsync(rendered, rendered, rendered ? "ok" : "setup-not-rendered");
                    }
                    catch { if (!quitting) await SmokeFinishAsync(false, false, "renderer-check-failed"); }
                };
                await StartServiceAsync();
            }
            catch { await StartupFailedAsync("无法初始化本机运行环境。请确认 WebView2 Runtime 已安装，并重新安装完整的 Switchboard。", "webview-initialization-failed"); }
        }

        private async Task StartServiceAsync(string importFrom = null)
        {
            var current = ++generation;
            stopping = false; origin = null;
            if (bootstrapScript != null) { web.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(bootstrapScript); bootstrapScript = null; }
            SetStatus(importFrom == null ? "正在启动本机工作空间…" : "正在导入独立数据副本…");
            ready = new TaskCompletionSource<Dictionary<string, object>>(TaskCreationOptions.RunContinuationsAsynchronously);
            try
            {
                using (var random = RandomNumberGenerator.Create()) { var bytes = new byte[32]; random.GetBytes(bytes); authSecret = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
                var root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "resources");
                var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), Quote(Path.Combine(root, "server", "desktop", "runtime.mjs")))
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Program.SupportDir };
                start.EnvironmentVariables.Remove("NODE_OPTIONS"); start.EnvironmentVariables.Remove("NODE_PATH");
                start.EnvironmentVariables["SWITCHBOARD_DESKTOP_SUPPORT_DIR"] = Program.SupportDir;
                start.EnvironmentVariables["SWITCHBOARD_DESKTOP_BOOTSTRAP"] = authSecret;
                start.EnvironmentVariables["SWITCHBOARD_DESKTOP_PORT"] = Program.Smoke ? "0" : "3110";
                start.EnvironmentVariables["SWITCHBOARD_DESKTOP_CONTROL"] = "stdio";
                start.EnvironmentVariables.Remove("SWITCHBOARD_DESKTOP_IMPORT");
                if (importFrom != null) start.EnvironmentVariables["SWITCHBOARD_DESKTOP_IMPORT"] = importFrom;
                var process = new Process { StartInfo = start, EnableRaisingEvents = true };
                process.OutputDataReceived += (s, e) => ReadOutput(e.Data, current);
                process.ErrorDataReceived += (s, e) => LogServiceDiagnostic(e.Data);
                process.Exited += (s, e) =>
                {
                    if (current != generation) return;
                    ready.TrySetException(new InvalidOperationException("service-exited"));
                    if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(() =>
                    { if (!stopping && !quitting) { origin = null; SetStatus("本机服务已停止，请从菜单重启"); } }));
                };
                child = process;
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
                if (await Task.WhenAny(ready.Task, Task.Delay(45000)) != ready.Task) throw new TimeoutException();
                var message = await ready.Task;
                if (current != generation || stopping || quitting) return;
                var address = new Uri((string)message["url"]);
                using (var response = await http.GetAsync(new Uri(address, "/readyz"))) response.EnsureSuccessStatusCode();
                if (current != generation || stopping || quitting) return;
                origin = address;
                if (message.TryGetValue("profileDir", out var profile) && profile is string path && IsInside(path, Program.SupportDir)) profileDir = path;
                if (message.TryGetValue("needsSetup", out var setup) && setup is bool needsSetup && needsSetup)
                {
                    var config = Program.Json.Serialize(new { token = authSecret, origin = origin.GetLeftPart(UriPartial.Authority) });
                    // AddScript also runs in frames: explicitly require main frame
                    // and the exact loopback origin before touching the DOM.
                    bootstrapScript = await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"(() => {
                      const config = " + config + @";
                      if (window.top !== window || location.origin !== config.origin) return;
                      const fill = () => { const input=document.querySelector('#account-login input[name=bootstrapToken]');
                        if (!input) return; input.value=config.token; input.closest('label').hidden=true;
                        const hint=document.querySelector('#account-login > p');
                        const text='设置姓名、邮箱与密码，开始使用本机工作空间。密码至少 12 个字符。';
                        if(hint && hint.textContent!==text)hint.textContent=text; };
                      document.addEventListener('DOMContentLoaded',()=>{new MutationObserver(fill).observe(document.documentElement,{childList:true,subtree:true});fill();},{once:true});
                    })();");
                }
                if (current != generation || stopping || quitting) return;
                SetStatus("本机 API · " + origin.GetLeftPart(UriPartial.Authority) + "/v1");
                web.CoreWebView2.Navigate(origin.AbsoluteUri);
            }
            catch { if (!quitting && current == generation) await StartupFailedAsync("本机服务启动失败或超时。请检查安装是否完整、数据目录是否可写。原工作空间数据已保留。", "service-start-failed"); }
        }

        private void ReadOutput(string line, int current)
        {
            if (current != generation || string.IsNullOrEmpty(line) || line.Length > 8192) return;
            try
            {
                var message = Program.Json.Deserialize<Dictionary<string, object>>(line);
                if (!message.TryGetValue("event", out var evt) || !Equals(evt, "desktop-ready") || !message.TryGetValue("url", out var text) || !(text is string address)) return;
                if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.Port <= 0 || uri.UserInfo.Length > 0 || uri.AbsolutePath != "/" || uri.Query.Length > 0 || uri.Fragment.Length > 0) return;
                ready.TrySetResult(message);
            }
            catch { }
        }

        private void LogServiceDiagnostic(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            // Never persist arbitrary upstream stderr: it can contain URLs,
            // prompts or credentials. Keep only classified, nonsecret events.
            var code = line.Contains("desktop-error") ? "desktop-error" : line.Contains("ExperimentalWarning") ? "runtime-experimental-warning" : "service-diagnostic";
            lock (logGate)
            {
                try
                {
                    var file = Path.Combine(Program.SupportDir, "desktop.log");
                    if (File.Exists(file) && new FileInfo(file).Length > 1048576)
                    { var previous = file + ".1"; if (File.Exists(previous)) File.Delete(previous); File.Move(file, previous); }
                    File.AppendAllText(file, DateTime.UtcNow.ToString("O") + " " + code + Environment.NewLine, new UTF8Encoding(false));
                }
                catch { }
            }
        }

        private Task StopServiceAsync()
        {
            if (stopTask != null && !stopTask.IsCompleted) return stopTask;
            return stopTask = StopServiceCoreAsync();
        }

        private async Task StopServiceCoreAsync()
        {
            stopping = true;
            await CancelAuthenticationAsync();
            origin = null;
            SetStatus("本机服务正在停止…");
            var process = child;
            if (process == null) return;
            try
            {
                if (!process.HasExited)
                {
                    process.StandardInput.WriteLine("{\"command\":\"shutdown\"}"); process.StandardInput.Flush(); process.StandardInput.Close();
                    var ended = await Task.Run(() => process.WaitForExit(12000));
                    if (!ended && !process.HasExited) { process.Kill(); await Task.Run(() => process.WaitForExit(3000)); }
                }
            }
            catch { try { if (!process.HasExited) process.Kill(); } catch { } }
            finally { if (ReferenceEquals(child, process)) child = null; process.Dispose(); }
        }

        private async Task StartupFailedAsync(string message, string reason)
        {
            await StopServiceAsync(); SetStatus("本机服务未运行");
            if (Program.Smoke) { await SmokeFinishAsync(false, false, reason); return; }
            if (MessageBox.Show(this, message + "\n\n是否重试？", "无法打开工作空间", MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning) == DialogResult.Retry) await StartServiceAsync();
        }

        private async Task SmokeFinishAsync(bool ok, bool loaded, string reason)
        {
            if (quitting) return;
            if (loaded)
            {
                try
                {
                    using (var screenshot = File.Create(Path.Combine(Program.SupportDir, "smoke-window.png")))
                        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
                }
                catch { }
            }
            Program.SmokeResult(ok, origin != null, loaded, reason);
            await QuitAsync();
        }

        private async Task QuitAsync()
        {
            if (quitting) return;
            quitting = true; authTimer.Stop();
            await StopServiceAsync();
            exited = true; tray.Visible = false; Close();
        }

        private async void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (exited) return;
            e.Cancel = true;
            if (e.CloseReason == CloseReason.UserClosing && !Program.Smoke && !quitting)
            { Hide(); tray.ShowBalloonTip(2000, "Switchboard 仍在运行", "本机 API 服务继续运行；从托盘菜单选择“退出”可关闭服务。", ToolTipIcon.Info); }
            else await QuitAsync();
        }

        private async Task RestartAsync(string importFrom = null)
        {
            if (quitting || restarting) return;
            restarting = true;
            try { await StopServiceAsync(); if (!quitting) await StartServiceAsync(importFrom); }
            finally { restarting = false; }
        }

        private async Task ImportAsync()
        {
            using (var dialog = new FolderBrowserDialog { Description = "选择包含 .env 与 data 的完整部署目录；原数据不会修改。建议先停止原服务。", ShowNewFolderButton = false })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                var source = dialog.SelectedPath;
                if (!File.Exists(Path.Combine(source, ".env")) || !Directory.Exists(Path.Combine(source, "data")))
                { MessageBox.Show(this, "目录不完整：请选择同时包含 .env 和 data 的部署目录。", "无法导入"); return; }
                if (MessageBox.Show(this, "将导入独立副本，并切换至导入后的工作空间。原目录和当前工作空间保留。\n\n是否继续？", "导入部署", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) == DialogResult.OK) await RestartAsync(source);
            }
        }

        private void NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (e.Uri == "about:blank") return;
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) { e.Cancel = true; return; }
            if (IsLocal(uri))
            {
                if (uri.AbsolutePath == "/api/account/chatgpt/authorize" || uri.AbsolutePath == "/api/account/sso/feishu/start" || uri.AbsolutePath == "/api/account/sso/feishu/desktop/authorize")
                { e.Cancel = true; _ = HandleLocalAuthAsync(uri); }
                return;
            }
            e.Cancel = true;
            if (e.IsUserInitiated) TryOpenBrowser(uri.AbsoluteUri);
        }

        private async Task<bool> HandleLocalAuthAsync(Uri uri)
        {
            if (!IsLocal(uri)) return false;
            if (uri.AbsolutePath == "/api/account/chatgpt/authorize") { TryOpenBrowser(uri.AbsoluteUri); return true; }
            if (uri.AbsolutePath == "/api/account/sso/feishu/start") { await StartLoginAsync(HttpUtility.ParseQueryString(uri.Query)["provider"]); return true; }
            if (uri.AbsolutePath == "/api/account/sso/feishu/desktop/authorize")
            {
                var id = HttpUtility.ParseQueryString(uri.Query)["id"];
                var ticket = HttpUtility.ParseQueryString(uri.Query)["ticket"];
                if (IsNonce(id) && IsNonce(ticket)) await BeginAuthenticationAsync(uri, id);
                return true;
            }
            return false;
        }

        private async Task StartLoginAsync(string provider)
        {
            if (authStarting || origin == null) return;
            await CancelAuthenticationAsync(); authStarting = true;
            var current = generation;
            try
            {
                var response = await NativeRequestAsync("start", new { provider = provider ?? "" });
                if (current != generation || quitting) return;
                if (!response.Data.TryGetValue("id", out var id) || !response.Data.TryGetValue("url", out var url) || !(id is string flow) || !IsNonce(flow) || !(url is string address)) throw new InvalidOperationException();
                await BeginAuthenticationAsync(new Uri(address), flow);
            }
            catch { if (current == generation && !quitting) AuthenticationError("无法发起飞书登录，请检查企业绑定和本机回调配置后重试。"); }
            finally { authStarting = false; }
        }

        private async Task BeginAuthenticationAsync(Uri url, string id)
        {
            if (!IsLocal(url) || url.AbsolutePath != "/api/account/sso/feishu/desktop/authorize" || !IsNonce(id)) return;
            await CancelAuthenticationAsync();
            flowId = id; flowExpires = DateTime.UtcNow.AddMinutes(10); cancelLogin.Enabled = true;
            try { Program.OpenWeb(url.AbsoluteUri); SetStatus("正在等待浏览器完成飞书授权…"); }
            catch { await CancelAuthenticationAsync(); AuthenticationError("无法打开系统浏览器，请设置默认浏览器后重试。"); }
        }

        private async Task CancelAuthenticationAsync()
        {
            var id = flowId; flowId = null; authStarting = false; authCompleting = false; cancelLogin.Enabled = false;
            if (id == null || origin == null) return;
            try { await NativeRequestAsync("cancel", new { id }); } catch { }
            if (origin != null) SetStatus("本机 API · " + origin.GetLeftPart(UriPartial.Authority) + "/v1");
        }

        internal void PostActivation(string text)
        {
            if (!Program.ValidActivation(text) || IsDisposed || !IsHandleCreated) return;
            BeginInvoke(new Action(async () =>
            {
                if (text == "focus") { BringForward(); return; }
                var uri = new Uri(text);
                if (uri.Host == "subscription-connected") { ShowPage("providers"); return; }
                if (uri.Host != "feishu-login" || flowId == null || authCompleting || origin == null || DateTime.UtcNow > flowExpires) return;
                var id = flowId; var current = generation; authCompleting = true;
                try
                {
                    var response = await NativeRequestAsync("complete", new { id, code = HttpUtility.ParseQueryString(uri.Query)["code"] });
                    if (current != generation || flowId != id || quitting) return;
                    var path = response.Data.TryGetValue("path", out var value) ? value as string : null;
                    if (path != "/#overview" && path != "/#account") throw new InvalidOperationException();
                    foreach (Cookie cookie in response.Cookies.GetCookies(origin))
                    {
                        if (cookie.Name != "sr_session" || cookie.Domain != origin.Host) continue;
                        var stored = web.CoreWebView2.CookieManager.CreateCookie(cookie.Name, cookie.Value, origin.Host, "/");
                        stored.IsHttpOnly = true; stored.IsSecure = false; stored.SameSite = CoreWebView2CookieSameSiteKind.Lax;
                        if (cookie.Expires != DateTime.MinValue) stored.Expires = cookie.Expires.ToUniversalTime();
                        web.CoreWebView2.CookieManager.AddOrUpdateCookie(stored);
                    }
                    flowId = null; cancelLogin.Enabled = false;
                    web.CoreWebView2.Navigate(new Uri(origin, path).AbsoluteUri); BringForward();
                    SetStatus("本机 API · " + origin.GetLeftPart(UriPartial.Authority) + "/v1");
                }
                catch { if (current == generation && !quitting) { await CancelAuthenticationAsync(); AuthenticationError("飞书授权未完成或已失效，请回到登录页重试。确认企业应用已发布、用户有权限，且回调地址与本机 App 一致。"); } }
                finally { authCompleting = false; }
            }));
        }

        private sealed class NativeResponse { internal Dictionary<string, object> Data; internal CookieContainer Cookies; }
        private async Task<NativeResponse> NativeRequestAsync(string route, object payload)
        {
            var baseUri = origin ?? throw new InvalidOperationException();
            using (var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "/api/account/sso/feishu/desktop/" + route)))
            {
                request.Headers.Add("X-Switchboard-Desktop", authSecret);
                request.Content = new StringContent(Program.Json.Serialize(payload), Encoding.UTF8, "application/json");
                using (var timeout = new CancellationTokenSource(route == "cancel" ? 2000 : 20000))
                using (var response = await http.SendAsync(request, timeout.Token))
                {
                    response.EnsureSuccessStatusCode();
                    var cookies = new CookieContainer();
                    if (response.Headers.TryGetValues("Set-Cookie", out var headers))
                        foreach (var header in headers) cookies.SetCookies(baseUri, header);
                    return new NativeResponse { Data = Program.Json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()), Cookies = cookies };
                }
            }
        }

        private bool IsLocal(string address) { return Uri.TryCreate(address, UriKind.Absolute, out var uri) && IsLocal(uri); }
        private bool IsLocal(Uri uri) { return origin != null && uri != null && uri.Scheme == origin.Scheme && uri.Host == origin.Host && uri.Port == origin.Port && uri.UserInfo.Length == 0; }
        private static bool IsNonce(string value) { return value != null && Regex.IsMatch(value, "^[a-f0-9]{64}$"); }
        private static bool IsInside(string value, string parent) { return Path.GetFullPath(value).StartsWith(Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
        private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
        private void SetStatus(string text) { if (!IsDisposed) { status.Text = text; tray.Text = "Switchboard · " + (origin == null ? "本机服务未就绪" : "本机服务已就绪"); } }
        private void BringForward() { Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); }
        private async void ShowPage(string page)
        {
            BringForward();
            if (origin == null || !new[] { "overview", "playground", "routing", "providers" }.Contains(page)) return;
            try { await web.CoreWebView2.ExecuteScriptAsync("location.hash=" + Program.Json.Serialize("#" + page)); } catch { }
        }
        private void Reload() { if (origin != null) web.Reload(); }
        private void OpenBrowser() { if (origin != null) TryOpenBrowser(origin.AbsoluteUri); }
        private void TryOpenBrowser(string address) { try { Program.OpenWeb(address); } catch { if (!Program.Smoke) MessageBox.Show(this, "无法打开默认浏览器，请检查 Windows 默认应用设置。", "Switchboard"); } }
        private void CopyApi() { if (origin != null) try { Clipboard.SetText(origin.GetLeftPart(UriPartial.Authority) + "/v1"); } catch { } }
        private void OpenData() { var path = profileDir ?? Program.SupportDir; if (Directory.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        private void FeishuHelp()
        {
            var callback = (origin?.GetLeftPart(UriPartial.Authority) ?? "http://127.0.0.1:3110") + "/api/account/sso/feishu/callback";
            if (MessageBox.Show(this, "飞书使用系统浏览器授权，完成后自动返回 App。\n\n每个企业应用的“安全设置 → 重定向 URL”需登记：\n" + callback + "\n\n保留原有回调。若端口被占用，请登记本机界面显示的实际地址，或关闭占用 3110 的程序后重启。\n\n是否复制此地址？", "飞书登录配置", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes) Clipboard.SetText(callback);
        }
        private void AuthenticationError(string message) { BringForward(); MessageBox.Show(this, message, "飞书登录未完成", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { authTimer.Dispose(); tray.Dispose(); http.Dispose(); web.Dispose(); }
            base.Dispose(disposing);
        }
    }
}

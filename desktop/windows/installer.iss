#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{778041DC-4212-4FC8-A595-E025770931F1}
AppName=Switchboard
AppVersion={#AppVersion}
AppPublisher=Switchboard contributors
AppPublisherURL=https://github.com/chensl139-ok/switchboard-ai-router
AppSupportURL=https://github.com/chensl139-ok/switchboard-ai-router/issues
DefaultDirName={localappdata}\Programs\Switchboard
DefaultGroupName=Switchboard
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.18362
OutputDir={#OutputDir}
OutputBaseFilename=Switchboard-{#AppVersion}-Windows-x64-Setup
SetupIconFile=Switchboard.ico
UninstallDisplayIcon={app}\Switchboard.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes
UsePreviousAppDir=yes
UninstallDisplayName=Switchboard
VersionInfoVersion={#AppVersion}
InfoBeforeFile=INSTALL.txt

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Switchboard"; Filename: "{app}\Switchboard.exe"
Name: "{userdesktop}\Switchboard"; Filename: "{app}\Switchboard.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\switchboard"; ValueType: string; ValueName: ""; ValueData: "URL:Switchboard Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\switchboard"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\switchboard\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Switchboard.exe,0"
Root: HKCU; Subkey: "Software\Classes\switchboard\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Switchboard.exe"" ""%1"""

[Run]
Filename: "https://developer.microsoft.com/microsoft-edge/webview2/"; Description: "Download Microsoft WebView2 Runtime (required, opens Microsoft website)"; Flags: postinstall shellexec skipifsilent unchecked; Check: NeedsWebView2
Filename: "{app}\Switchboard.exe"; Description: "Launch Switchboard"; Flags: postinstall nowait skipifsilent; Check: HasWebView2

[Code]
function HasWebView2: Boolean;
var
  Version: String;
begin
  Result := (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function NeedsWebView2: Boolean;
begin
  Result := not HasWebView2;
end;

function InitializeSetup: Boolean;
var
  Release: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM32, 'Software\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) and (Release >= 528040);
  if not Result then
    MsgBox('Switchboard requires .NET Framework 4.8 or later. Install Windows updates or the official Microsoft .NET Framework 4.8 runtime, then run this installer again.', mbError, MB_OK);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and NeedsWebView2 then
    WizardForm.FinishedLabel.Caption := 'Switchboard is installed. Microsoft WebView2 Runtime is required before first launch. Select the download option below to open the official Microsoft website. No runtime is downloaded or installed without your action.';
end;

// No UninstallDelete rules: %LOCALAPPDATA%\Switchboard contains private user data
// and must survive app replacement and uninstall.

param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Switchboard'
$dataDir = Join-Path $env:LOCALAPPDATA 'Switchboard'
$checks = Join-Path $env:GITHUB_WORKSPACE 'dist\windows\validation'
$supportDir = Join-Path $env:RUNNER_TEMP ('switchboard-shell-smoke-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path $installDir) { throw 'Refusing to replace an existing installation during CI smoke test' }
if (Test-Path $dataDir) { throw 'Refusing to touch an existing user workspace during CI smoke test' }
New-Item -ItemType Directory -Path $checks, $dataDir -Force | Out-Null
$sentinel = Join-Path $dataDir 'installer-preservation-proof.txt'
[IO.File]::WriteAllText($sentinel, 'keep-user-data')

$setup = Start-Process -FilePath $Installer -ArgumentList '/CURRENTUSER', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "Installer exited $($setup.ExitCode)" }
$app = Join-Path $installDir 'Switchboard.exe'
if (!(Test-Path $app)) { throw 'Per-user installation was not created at the expected location' }
$command = (Get-Item 'Registry::HKEY_CURRENT_USER\Software\Classes\switchboard\shell\open\command').GetValue('')
if (!$command.Contains($app) -or !$command.Contains('"%1"')) { throw 'Per-user callback protocol registration is missing or unquoted' }

$process = Start-Process -FilePath $app -ArgumentList '--smoke-test', '--support-dir', ('"' + $supportDir + '"') -PassThru
if (!$process.WaitForExit(180000)) {
  $process.Kill($true)
  throw 'Native WebView2 smoke test timed out'
}
$resultFile = Join-Path $supportDir 'smoke-result.json'
if (Test-Path $resultFile) { Copy-Item -LiteralPath $resultFile -Destination $checks }
$screenshot = Join-Path $supportDir 'smoke-window.png'
if (Test-Path $screenshot) { Copy-Item -LiteralPath $screenshot -Destination $checks }
if ($process.ExitCode -ne 0) { throw "Native WebView2 smoke test exited $($process.ExitCode)" }
if (!(Test-Path $resultFile)) { throw 'Native smoke test did not emit a result' }
$result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
if (!$result.ok -or !$result.serviceReady -or !$result.pageLoaded) { throw 'Native shell did not load the local application successfully' }
if (Test-Path (Join-Path $supportDir 'desktop.lock')) { throw 'Shell left a running child service / data lock' }
$acl = Get-Acl -LiteralPath $supportDir
if (!$acl.AreAccessRulesProtected) { throw 'Private workspace inherits unrelated parent ACLs' }
$broadIdentities = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
foreach ($rule in $acl.Access) {
  $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -eq 'Allow' -and $broadIdentities -contains $sid) { throw 'Private workspace grants broad user access' }
}

$uninstaller = Join-Path $installDir 'unins000.exe'
$remove = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -PassThru -Wait
if ($remove.ExitCode -ne 0) { throw "Uninstaller exited $($remove.ExitCode)" }
if (Test-Path $app) { throw 'Uninstall did not remove the executable' }
if (Test-Path 'Registry::HKEY_CURRENT_USER\Software\Classes\switchboard') { throw 'Uninstall did not remove the application callback scheme' }
if ([IO.File]::ReadAllText($sentinel) -ne 'keep-user-data') { throw 'Uninstall modified the user workspace' }
if (!(Test-Path (Join-Path $supportDir 'active-profile.json'))) { throw 'Uninstall deleted the test workspace' }
@{ ok=$true; installedPerUser=$true; schemeRegistered=$true; nativePageLoaded=$true; privateAcl=$true; uninstallPreservedData=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $checks 'installer-result.json')
Write-Host 'Per-user install, native page, private ACL, callback registration, shutdown and data-preserving uninstall passed.'

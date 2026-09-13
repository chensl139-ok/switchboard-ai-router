param([switch]$Public)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Please install Node.js 22 LTS and Docker Desktop, then run this script again."
}
if ($Public) { & node scripts/deploy.mjs --public } else { & node scripts/deploy.mjs }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

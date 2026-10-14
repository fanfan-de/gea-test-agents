param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet("validate", "pack", "dev", "push")]
  [string]$Command,
  [string]$Project,
  [string]$SourceRoot,
  [string]$ConfigDir
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 otherwise replaces the Chinese project path in stdin.
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../gea-worktree"))
}
if ([string]::IsNullOrWhiteSpace($ConfigDir)) {
  $ConfigDir = Join-Path $PSScriptRoot ".gea/cli-config"
}
$nodeVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot ".node-version") -Raw).Trim()
if ((& node --version) -ne "v$nodeVersion") {
  throw "Activate Node.js $nodeVersion before running this script."
}
if ((& pnpm --version) -ne "12.8.1") {
  throw "Activate pnpm 12.8.1 before running this script."
}

$payload = @{ cwd = $PSScriptRoot }
if ($Command -eq "dev") {
  $payload.modelSource = "hosted"
}
if ($Command -eq "push") {
  if ([string]::IsNullOrWhiteSpace($Project)) {
    throw "Provide the Studio project slug with -Project."
  }
  $payload.project = $Project
  $payload.slug = "feishu-basic-test"
}

$previousConfigDir = $env:GEA_CONFIG_DIR
$env:GEA_CONFIG_DIR = [System.IO.Path]::GetFullPath($ConfigDir)
Push-Location (Join-Path $SourceRoot "packages/gea-cli")
try {
  $payload | ConvertTo-Json -Compress | & pnpm exec jiti src/bin.ts agent $Command --json-file -
  $commandExitCode = $LASTEXITCODE
} finally {
  Pop-Location
  $env:GEA_CONFIG_DIR = $previousConfigDir
}
exit $commandExitCode

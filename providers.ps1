param(
  [Parameter(Position = 0)]
  [ValidateSet("setup", "install", "validate", "pack", "start", "stop", "status", "publish", "test", "dev", "pair-device")]
  [string]$Command = "status",
  [ValidateSet("all", "default", "justbash", "e2b", "remote", "local", "device")]
  [string]$Provider = "all"
)
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "computer-providers.config.json") -Raw | ConvertFrom-Json
if ($Command -eq "setup") {
  & (Join-Path $PSScriptRoot "sync-current-source.ps1")
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $Command = "install"
}
$windowsScriptPath = (Join-Path $PSScriptRoot "providers.sh").Replace('\', '/')
$scriptPath = (& wsl.exe -d $config.wslDistribution -u $config.wslUser --exec wslpath -a $windowsScriptPath).Trim()
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve the provider launcher path in WSL." }
& wsl.exe -d $config.wslDistribution -u $config.wslUser --exec bash $scriptPath $Command $Provider
exit $LASTEXITCODE

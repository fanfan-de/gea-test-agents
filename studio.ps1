param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "doctor", "unit", "validate", "pack", "publish", "test")]
  [string]$Command = "doctor"
)
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$requiredNode = (Get-Content -LiteralPath (Join-Path $PSScriptRoot ".node-version") -Raw).Trim()
$fnm = Get-Command fnm -ErrorAction SilentlyContinue

function Invoke-PinnedTool {
  param([string]$Executable, [string[]]$ToolArguments)
  if ($fnm) {
    & $fnm.Source exec "--using=$requiredNode" $Executable @ToolArguments
  } else {
    if ((& node --version) -ne "v$requiredNode") {
      throw "Use Node $requiredNode as specified in .node-version."
    }
    & $Executable @ToolArguments
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($Command -eq "install") {
  $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "studio.config.json") -Raw | ConvertFrom-Json
  foreach ($directory in @($config.sourceRoot, (Join-Path $PSScriptRoot $config.projectDirectory))) {
    Push-Location -LiteralPath $directory
    try {
      Invoke-PinnedTool "pnpm.cmd" @("install", "--frozen-lockfile")
    } finally {
      Pop-Location
    }
  }
} else {
  Invoke-PinnedTool "node" @((Join-Path $PSScriptRoot "scripts/studio.mjs"), $Command)
}

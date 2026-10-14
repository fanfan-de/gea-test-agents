$ErrorActionPreference = "Stop"
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "computer-providers.config.json") -Raw | ConvertFrom-Json
$sourceDirectory = [System.IO.Path]::GetFullPath($config.windowsSourceRoot)
if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory ".git"))) {
  throw "Current sourceRoot must be a Git checkout."
}
$gitRoot = (& git -C $sourceDirectory rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($gitRoot) -ne $sourceDirectory) {
  throw "Source root does not match its Git checkout."
}
$localDirectory = Join-Path $PSScriptRoot ".local"
New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
$files = @(& git -c core.quotepath=false -C $sourceDirectory ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw "Cannot list current source files." }
$files = @($files | Where-Object { $_ -notmatch '(^|/)\.env($|\.)' -or $_ -match '\.example$' })
$listPath = Join-Path $localDirectory "current-source-files.txt"
[System.IO.File]::WriteAllLines($listPath, $files, [System.Text.UTF8Encoding]::new($false))
$archivePath = Join-Path $localDirectory "current-source.tar"
& tar.exe -cf $archivePath -C $sourceDirectory -T $listPath
if ($LASTEXITCODE -ne 0) { throw "Current source archive failed." }
$archiveWsl = (& wsl.exe -d $config.wslDistribution -u $config.wslUser --exec wslpath -a $archivePath.Replace('\', '/')).Trim()
$windowsScriptPath = (Join-Path $PSScriptRoot "scripts/setup-build.sh").Replace('\', '/')
$scriptWsl = (& wsl.exe -d $config.wslDistribution -u $config.wslUser --exec wslpath -a $windowsScriptPath).Trim()
& wsl.exe -d $config.wslDistribution -u $config.wslUser --exec bash $scriptWsl $archiveWsl $config.sourceRoot $config.nativeTargetRoot
if ($LASTEXITCODE -ne 0) { throw "Current source installation/build failed." }

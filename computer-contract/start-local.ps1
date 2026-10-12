$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$settings = Get-Content -LiteralPath (Join-Path $projectDirectory 'local-test.config.json') -Raw | ConvertFrom-Json
$scriptPath = '/mnt/c/Projects/GEA测试Agents/computer-contract/start-local.sh'
& wsl.exe -d Ubuntu -u fanfande -- bash $scriptPath --status
if ($LASTEXITCODE -ne 0) {
    $logDirectory = Join-Path $projectDirectory '.local'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logName = 'launcher-' + (Get-Date -Format 'yyyyMMdd-HHmmss-ffffff')
    $launcher = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', 'Ubuntu', '-u', 'fanfande', '--', 'bash', $scriptPath) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory ($logName + '.stdout.log')) -RedirectStandardError (Join-Path $logDirectory ($logName + '.stderr.log')) -PassThru
    Write-Host '正在启动本地 Agent Studio，等待服务就绪…'
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($launcher -and $launcher.HasExited -and $launcher.ExitCode -ne 0) {
        throw "启动失败，请查看 .local/$logName.stderr.log"
    }
    try {
        $runtimeHealth = Invoke-WebRequest -Uri "http://127.0.0.1:$($settings.runtimePort)/healthz" -NoProxy -TimeoutSec 2
        $studioPage = Invoke-WebRequest -Uri "http://127.0.0.1:$($settings.webPort)/readyz" -Headers @{ Host = "musegea.localhost:$($settings.webPort)" } -NoProxy -TimeoutSec 10
        if ($runtimeHealth.StatusCode -eq 200 -and $studioPage.StatusCode -eq 200) {
            Write-Host '本地 Agent Studio 已启动：http://musegea.localhost:3002/'
            Write-Host '测试入口：http://local-test.musegea.localhost:3002/studio/default'
            exit 0
        }
    } catch {
        # 等待 WSL 中的 Runtime 和开发服务器响应健康检查。
    }
    Start-Sleep -Seconds 1
}
throw 'Studio 未就绪，请查看 .local 的启动器日志。'

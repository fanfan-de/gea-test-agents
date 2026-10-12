$ErrorActionPreference = 'Stop'
wsl -d Ubuntu -u fanfande -- bash /mnt/c/Projects/GEA测试Agents/computer-contract/stop-local.sh
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

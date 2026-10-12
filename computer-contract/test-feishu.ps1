$ErrorActionPreference = 'Stop'
wsl.exe -d Ubuntu -u fanfande -- bash /mnt/c/Projects/GEA测试Agents/computer-contract/test-feishu.sh
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

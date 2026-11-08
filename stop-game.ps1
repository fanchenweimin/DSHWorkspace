$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'data\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host '没有找到 data\server.pid。'
  Write-Host '如果服务是在终端里启动的，回到那个窗口按 Ctrl+C。'
  Write-Host '按端口查找：Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object OwningProcess'
  exit 1
}
$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
try {
  Stop-Process -Id $serverPid -Force
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "已停止服务进程 $serverPid。"
} catch {
  Write-Host "停止失败：$($_.Exception.Message)"
  exit 1
}

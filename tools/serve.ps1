<#
  tools/serve.ps1 — 后台启动看板服务器（默认端口 4030，自动推进 tick）
  用法：
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1            # 启动
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Stop      # 停止
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 5000 # 换端口
  日志：.data-live\server.out.log / server.err.log
#>
param([int]$Port = 4030, [switch]$Stop, [string]$DataDir = ".data-live")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$pidFile = Join-Path $root ($DataDir + "\server.pid")

if ($Stop) {
  if (Test-Path -LiteralPath $pidFile) {
    $old = [int](Get-Content -LiteralPath $pidFile -Raw)
    try { Stop-Process -Id $old -Force -ErrorAction Stop; Write-Output ("stopped pid " + $old) } catch { Write-Output ("pid " + $old + " 已经不在跑了") }
    Remove-Item -LiteralPath $pidFile -Force
  } else { Write-Output "没有记录到在跑的服务器（.data-live\server.pid 不存在）" }
  exit 0
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:PORT = "$Port"
$env:PP_AUTOTICK_MS = "1200"; $env:PP_AUTOTICK_TICKS = "1"; $env:PP_FOUNDERS = "40"
$env:PP_DATA_DIR = $DataDir; $env:PP_BIO_FILE = "$DataDir/biosphere.json"
$env:PP_BIO_NAME = "Arc Biosphere"; $env:PP_WEB_DIR = "web"
$p = Start-Process -FilePath "node" -ArgumentList "src/life-server.js" -WorkingDirectory $root `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $root "$DataDir\server.out.log") `
      -RedirectStandardError  (Join-Path $root "$DataDir\server.err.log")
Set-Content -LiteralPath $pidFile -Value $p.Id
Write-Output ("server pid " + $p.Id + "  ->  http://127.0.0.1:" + $Port + "/dashboard")
Write-Output ("停止：powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Stop")

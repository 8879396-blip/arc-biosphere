<#
  tools/screenshot.ps1 — 用本机 Chrome/Edge 的 headless 模式给看板截图（零依赖，不需要 npm/puppeteer）
  用法：
    powershell -ExecutionPolicy Bypass -File tools\screenshot.ps1                 # 自动起服务器 + 截 3 张图
    powershell -ExecutionPolicy Bypass -File tools\screenshot.ps1 -Port 4030     # 已经在跑了就只截图
    powershell -ExecutionPolicy Bypass -File tools\screenshot.ps1 -Out ..\shots  # 指定输出目录
#>
param(
  [int]$Port = 4180,
  [string]$Out = "..\shots",
  [int]$WaitSec = 40,
  [switch]$NoServer,
  [switch]$Og
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw "找不到 Chrome 或 Edge" }
Write-Output ("browser: " + $browser)

$abs = [System.IO.Path]::GetFullPath((Join-Path $root $Out))
New-Item -ItemType Directory -Force -Path $abs | Out-Null
$profile = Join-Path $env:TEMP ("chrome-shot-" + [guid]::NewGuid().ToString("N").Substring(0,8))

$proc = $null
if (-not $NoServer) {
  $env:PORT = "$Port"; $env:PP_AUTOTICK_MS = "80"; $env:PP_FOUNDERS = "60"
  $env:PP_DATA_DIR = ".data-shot"; $env:PP_BIO_FILE = ".data-shot/biosphere.json"; $env:PP_BIO_NAME = "Arc Biosphere"
  $proc = Start-Process -FilePath "node" -ArgumentList "src/life-server.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  Write-Output ("server pid: " + $proc.Id)
}

$base = "http://127.0.0.1:$Port"
$deadline = (Get-Date).AddSeconds($WaitSec)
do {
  Start-Sleep -Milliseconds 700
  try { $r = Invoke-WebRequest -Uri "$base/api/bio/meta" -TimeoutSec 3 -UseBasicParsing; $up = $r.StatusCode -eq 200 } catch { $up = $false }
} while (-not $up -and (Get-Date) -lt $deadline)
if (-not $up) { Write-Output "服务器没起来（$base 无响应）"; if ($proc) { Stop-Process -Id $proc.Id -Force }; exit 1 }
Write-Output "server up: $base"
Start-Sleep -Seconds 6   # 让它多跑几十个 tick，种群和曲线才有内容

$shots = @(
  @{ n = "dashboard-desktop"; u = "$base/dashboard"; w = 1440; h = 2400 },
  @{ n = "dashboard-mobile";  u = "$base/dashboard"; w = 390;  h = 2600 },
  @{ n = "verify-desktop";    u = "$base/verify";    w = 1440; h = 1400 }
)
if ($Og) { $shots += @{ n = "og"; u = "$base/og.html"; w = 1200; h = 630 } }
foreach ($s in $shots) {
  $file = Join-Path $abs ($s.n + ".png")
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  $args = @("--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
            "--force-device-scale-factor=1", "--window-size=$($s.w),$($s.h)",
            "--virtual-time-budget=20000", "--user-data-dir=$profile",
            "--screenshot=$file", $s.u)
  $p = Start-Process -FilePath $browser -ArgumentList $args -WindowStyle Hidden -PassThru -Wait
  if (Test-Path -LiteralPath $file) {
    $kb = [math]::Round((Get-Item -LiteralPath $file).Length / 1KB)
    Write-Output ("  ok " + $s.n + ".png  " + $s.w + "x" + $s.h + "  " + $kb + " KB")
  } else { Write-Output ("  FAILED " + $s.n + " (exit " + $p.ExitCode + ")") }
}

if ($Og -and (Test-Path -LiteralPath (Join-Path $abs "og.png"))) {
  Copy-Item -LiteralPath (Join-Path $abs "og.png") -Destination (Join-Path $root "web\og.png") -Force
  Write-Output ("  og.png -> web\og.png (" + [math]::Round((Get-Item (Join-Path $root 'web\og.png')).Length / 1KB) + " KB)")
}
if ($proc) { Stop-Process -Id $proc.Id -Force; Write-Output ("server stopped (pid " + $proc.Id + ")") }
Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ("output dir: " + $abs)

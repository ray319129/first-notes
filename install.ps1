# First Notes 安裝腳本（Windows）。用法（PowerShell）：
#   iwr -useb https://raw.githubusercontent.com/ray319129/first-notes/main/install.ps1 | iex
# 會下載最新版、放進 Spicetify 的 CustomApps、註冊並套用。重新執行一次就是更新。
$ErrorActionPreference = "Stop"
$repo = "ray319129/first-notes"
$name = "first-notes"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
  Write-Host "找不到 spicetify，請先安裝：https://spicetify.app/docs/getting-started" -ForegroundColor Red
  return
}

$appsDir = Join-Path (spicetify path userdata) "CustomApps"
$target = Join-Path $appsDir $name
$tmp = Join-Path ([IO.Path]::GetTempPath()) "$name-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmp | Out-Null

try {
  Write-Host "下載最新版…"
  $zip = Join-Path $tmp "$name.zip"
  Invoke-WebRequest "https://github.com/$repo/releases/latest/download/$name.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $tmp -Force
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  New-Item -ItemType Directory -Force $appsDir | Out-Null
  Move-Item (Join-Path $tmp $name) $target

  Write-Host "註冊並套用…"
  spicetify config custom_apps $name
  spicetify apply
  Write-Host "安裝完成，Spotify 側邊欄會出現 First Notes。" -ForegroundColor Green
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

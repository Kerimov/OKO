# Signs Windows artifacts with signtool + PFX from .env.signing
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Files
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root ".env.signing"

if (-not (Test-Path $envFile)) {
  throw ".env.signing not found"
}

$pfx = ""
$password = ""
foreach ($line in Get-Content $envFile) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith("#")) { continue }
  if ($t -match "^CSC_LINK=(.+)$") {
    $pfx = $matches[1].Trim().Trim('"').Trim("'")
    if (-not [System.IO.Path]::IsPathRooted($pfx)) {
      $pfx = Join-Path $root $pfx
    }
  }
  if ($t -match "^CSC_KEY_PASSWORD=(.+)$") {
    $password = $matches[1].Trim().Trim('"').Trim("'")
  }
}

if (-not $pfx -or -not (Test-Path $pfx)) {
  throw "CSC_LINK PFX not found: $pfx"
}
if (-not $password) {
  throw "CSC_KEY_PASSWORD missing in .env.signing"
}

function Find-SignTool {
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $kits) {
    $found = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  $ebCache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign-2.6.0"
  if (Test-Path $ebCache) {
    $found = Get-ChildItem $ebCache -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  throw "signtool.exe not found. Install Windows SDK or run electron-builder once."
}

function Invoke-SignFile([string]$signtool, [string]$target) {
  & $signtool sign /fd SHA256 /f $pfx /p $password /tr http://timestamp.digicert.com /td SHA256 $target
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Timestamp failed, signing without timestamp..."
    & $signtool sign /fd SHA256 /f $pfx /p $password $target
    if ($LASTEXITCODE -ne 0) {
      throw "signtool failed for $target"
    }
  }
}

$signtool = Find-SignTool
Write-Host "Using $signtool"

foreach ($file in $Files) {
  if (-not (Test-Path $file)) {
    throw "File not found: $file"
  }
  $signed = $false
  try {
    Write-Host "Signing $file"
    Invoke-SignFile $signtool $file
    $signed = $true
  } catch {
    $dir = Split-Path $file -Parent
    $name = [System.IO.Path]::GetFileNameWithoutExtension($file)
    $ext = [System.IO.Path]::GetExtension($file)
    $tmp = Join-Path $dir "$name.signing$ext"
    Write-Host "File locked, signing via temp copy..."
    Copy-Item $file $tmp -Force
    Invoke-SignFile $signtool $tmp
    try {
      Move-Item $tmp $file -Force
      $signed = $true
    } catch {
      $alt = Join-Path $dir "$name-signed$ext"
      Move-Item $tmp $alt -Force
      Write-Host "Original locked. Signed copy: $alt"
      $signed = $true
    }
  }
  if (-not $signed) {
    throw "Could not sign $file"
  }
}

Write-Host "Done."

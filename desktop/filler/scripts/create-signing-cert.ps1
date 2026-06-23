# Self-signed code signing cert (internal / dev). For SmartScreen use commercial OV/EV.
param(
  [string]$Subject = "CN=OKO Zapolnenie, O=OKO, C=RU",
  [string]$OutPfx = "",
  [string]$Password = "change-me-after-create-cert",
  [int]$YearsValid = 3
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not $OutPfx) {
  $OutPfx = Join-Path $root "build\oko-signing.pfx"
}

$buildDir = Split-Path $OutPfx -Parent
if (-not (Test-Path $buildDir)) {
  New-Item -ItemType Directory -Path $buildDir | Out-Null
}

$notAfter = (Get-Date).AddYears($YearsValid)
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -HashAlgorithm SHA256 `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -NotAfter $notAfter

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $OutPfx -Password $secure | Out-Null

Write-Host ""
Write-Host "Certificate created."
Write-Host "  PFX:        $OutPfx"
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Valid until: $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. copy .env.signing.example .env.signing"
Write-Host "  2. set CSC_KEY_PASSWORD in .env.signing"
Write-Host "  3. npm run dist:signed"
Write-Host ""
Write-Host "Optional (domain PCs): export .cer and add to Trusted Root via certmgr.msc"

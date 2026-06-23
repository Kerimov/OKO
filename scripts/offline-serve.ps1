# Мини-сервер для OKO offline-kit (Windows, без Node.js).
$ErrorActionPreference = "Stop"
$Port = 8787
$Root = $PSScriptRoot
$Prefix = "http://localhost:$Port/"

$Mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif"  = "image/gif"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".woff" = "font/woff"
  ".woff2" = "font/woff2"
  ".txt"  = "text/plain; charset=utf-8"
  ".zip"  = "application/zip"
}

function Get-ContentType([string]$path) {
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($Mime.ContainsKey($ext)) { return $Mime[$ext] }
  return "application/octet-stream"
}

function Resolve-FilePath([string]$urlPath) {
  $rel = $urlPath.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
  if ([string]::IsNullOrWhiteSpace($rel)) {
    return Join-Path $Root "index.html"
  }
  $candidate = Join-Path $Root $rel
  if (Test-Path $candidate -PathType Leaf) { return $candidate }
  return Join-Path $Root "index.html"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)
$listener.Start()

Write-Host "OKO Offline: $Prefix"
Write-Host "Сервер ЦО не используется. Закройте это окно для остановки."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $filePath = Resolve-FilePath $context.Request.Url.LocalPath
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $context.Response.StatusCode = 200
      $context.Response.ContentType = Get-ContentType $filePath
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      $context.Response.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes("Not found")
      $context.Response.OutputStream.Write($msg, 0, $msg.Length)
    } finally {
      $context.Response.Close()
    }
  }
} finally {
  $listener.Stop()
}

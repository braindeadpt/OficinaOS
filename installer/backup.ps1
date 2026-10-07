# backup.ps1 (servico) — dump diario do Postgres com retencao de 14 dias.
# Variante do scripts\portable\BACKUP.ps1 para a instalacao como servico:
# os dados vivem em C:\ProgramData\OficinaOS (le o caminho do app\.env).
# Corre pela tarefa agendada "OficinaOS Backup" (03:30, SYSTEM) e pelo tray.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $env:ProgramData "OficinaOS"
$pgbin = Join-Path $root "pgsql\bin"
$dumpDir = Join-Path $dataRoot "backups"
$hbDir = Join-Path $dataRoot "uploads\backups-status"  # a app le o heartbeat daqui
$retentionDays = 14

New-Item -ItemType Directory -Force $dumpDir, $hbDir | Out-Null

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$target = Join-Path $dumpDir "oficinaos-$stamp.sql.gz"
$tmp = Join-Path $env:TEMP "oficinaos-dump-$stamp.sql"

& "$pgbin\pg_dump.exe" -h 127.0.0.1 -p 5433 -U postgres -d oficinaos `
    --format=plain --no-owner --no-privileges -f $tmp
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Write-Error "pg_dump falhou ou gerou um dump vazio"
    exit 1
}

Add-Type -AssemblyName System.IO.Compression
$in = [IO.File]::OpenRead($tmp)
$out = [IO.File]::Create($target)
$gz = New-Object IO.Compression.GzipStream($out, [IO.Compression.CompressionMode]::Compress)
try { $in.CopyTo($gz) } finally { $gz.Dispose(); $out.Dispose(); $in.Dispose(); Remove-Item $tmp }

$iso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
[IO.File]::WriteAllText((Join-Path $hbDir "last-backup.txt"), "$iso`n")

Get-ChildItem $dumpDir -Filter "oficinaos-*.sql.gz" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) } |
    Remove-Item -Force

Write-Output "backup ok: oficinaos-$stamp.sql.gz"

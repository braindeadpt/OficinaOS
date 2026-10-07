# BACKUP.ps1 (portable) — dump diario do Postgres portatil com retencao.
# Espelha scripts/db-backup.sh do stack Docker: mesmo formato de ficheiros
# (oficinaos-<UTC>.sql.gz) e o mesmo heartbeat que a app le
# (uploads/backups-status/last-backup.txt), para o indicador in-app funcionar.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pgbin = Join-Path $root "pgsql\bin"
$dumpDir = Join-Path $root "app\uploads\backups"
$hbDir = Join-Path $root "app\uploads\backups-status"
$retentionDays = 14

New-Item -ItemType Directory -Force $dumpDir, $hbDir | Out-Null

# Password do postgres (scram desde a v1.0.12) — escrita pelo gerar-env.ps1
# ou pelo harden-pg.ps1 nas instalacoes migradas.
if (Test-Path (Join-Path $root "app\.pgpass")) {
    $env:PGPASSWORD = (Get-Content (Join-Path $root "app\.pgpass") -First 1).Trim()
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$target = Join-Path $dumpDir "oficinaos-$stamp.sql.gz"
$tmp = Join-Path $env:TEMP "oficinaos-dump-$stamp.sql"

# Dump em formato plain para ficheiro temporario (sem pipe — evita
# problemas de encoding com texto UTF-8)
& "$pgbin\pg_dump.exe" -h 127.0.0.1 -p 5433 -U postgres -d oficinaos `
    --format=plain --no-owner --no-privileges -f $tmp
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Write-Error "pg_dump falhou ou gerou um dump vazio"
    exit 1
}

# Comprimir para .sql.gz (gzip real, nao zip)
Add-Type -AssemblyName System.IO.Compression
$in = [IO.File]::OpenRead($tmp)
$out = [IO.File]::Create($target)
$gz = New-Object IO.Compression.GzipStream($out, [IO.Compression.CompressionMode]::Compress)
try { $in.CopyTo($gz) } finally { $gz.Dispose(); $out.Dispose(); $in.Dispose(); Remove-Item $tmp }

# Heartbeat que a app le para "ultimo backup ha X horas"
$iso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
[IO.File]::WriteAllText((Join-Path $hbDir "last-backup.txt"), "$iso`n")

# Retencao: apaga dumps com mais de 14 dias
Get-ChildItem $dumpDir -Filter "oficinaos-*.sql.gz" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) } |
    Remove-Item -Force

Write-Output "backup ok: oficinaos-$stamp.sql.gz"

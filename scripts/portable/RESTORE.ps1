# RESTORE.ps1 (portable) — repoe a base de dados a partir de um dump .sql.gz.
# Equivalente ao scripts/db-restore/run-restore.sh do stack Docker.
# AVISO: substitui TODOS os dados atuais pelos do backup escolhido.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pgbin = Join-Path $root "pgsql\bin"
$pgdata = Join-Path $root "data"
$dumpDir = Join-Path $root "app\uploads\backups"

$dumps = Get-ChildItem $dumpDir -Filter "oficinaos-*.sql.gz" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
if (-not $dumps) {
    Write-Output "Nenhum backup encontrado em $dumpDir"
    exit 1
}

Write-Output "Backups disponiveis:"
for ($i = 0; $i -lt $dumps.Count; $i++) {
    Write-Output ("  [{0}] {1}  ({2:dd-MM-yyyy HH:mm})" -f ($i + 1), $dumps[$i].Name, $dumps[$i].LastWriteTime)
}
$pick = Read-Host "Numero do backup a restaurar [1]"
if ([string]::IsNullOrWhiteSpace($pick)) { $pick = "1" }
$num = 0
if (-not [int]::TryParse($pick, [ref]$num)) { Write-Error "Escolha invalida"; exit 1 }
$idx = $num - 1
if ($idx -lt 0 -or $idx -ge $dumps.Count) { Write-Error "Escolha invalida"; exit 1 }
$dump = $dumps[$idx]

$confirm = Read-Host "Isto SUBSTITUI todos os dados atuais por '$($dump.Name)'. Escreve SIM para continuar"
if ($confirm -ne "SIM") { Write-Output "Cancelado."; exit 0 }

# Parar a app (mas nao o Postgres) — o flag STOP impede o respawn
Set-Content -Path (Join-Path $root "STOP") -Value "stopped"
Get-Process bun -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$root*" } | Stop-Process -Force
Start-Sleep -Seconds 2

# Garantir o Postgres a correr
& "$pgbin\pg_ctl.exe" -D $pgdata status | Out-Null
if ($LASTEXITCODE -ne 0) {
    & "$pgbin\pg_ctl.exe" -D $pgdata -l (Join-Path $pgdata "postgres.log") -w start | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error "O Postgres nao arrancou. Ve data\postgres.log"; exit 1 }
}

# Descomprimir o dump para um .sql temporario
Add-Type -AssemblyName System.IO.Compression
$tmp = Join-Path $env:TEMP ("oficinaos-restore-" + [IO.Path]::GetFileNameWithoutExtension($dump.Name))
$in = [IO.File]::OpenRead($dump.FullName)
$gz = New-Object IO.Compression.GzipStream($in, [IO.Compression.CompressionMode]::Decompress)
$out = [IO.File]::Create($tmp)
try { $gz.CopyTo($out) } finally { $gz.Dispose(); $in.Dispose(); $out.Dispose() }

# Recriar a base de dados vazia e aplicar o dump
& "$pgbin\dropdb.exe" -h 127.0.0.1 -p 5433 -U postgres --if-exists oficinaos
& "$pgbin\createdb.exe" -h 127.0.0.1 -p 5433 -U postgres oficinaos
if ($LASTEXITCODE -ne 0) { Remove-Item $tmp; Write-Error "Falhou a recriacao da base de dados"; exit 1 }
& "$pgbin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d oficinaos -f $tmp -q
Remove-Item $tmp -ErrorAction SilentlyContinue

Remove-Item (Join-Path $root "STOP") -ErrorAction SilentlyContinue
Write-Output ""
Write-Output "Restore concluido. Corre INICIAR.bat para voltar a ligar o OficinaOS."

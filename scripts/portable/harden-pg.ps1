# harden-pg.ps1 (portable) — migra clusters pre-v1.0.12 de auth=trust para
# scram-sha-256. O trust em 127.0.0.1 dava acesso total a qualquer processo
# deste PC sem password. Corre a pedido do INICIAR.bat quando existe
# data\PG_VERSION mas falta app\.pgpass; tambem reconstroi o .pgpass a
# partir do .env se este se perdeu num update do app\.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pgData = Join-Path $root "data"
$pgBin = Join-Path $root "pgsql\bin"
$envPath = Join-Path $root "app\.env"
$pgpassPath = Join-Path $root "app\.pgpass"
$hba = Join-Path $pgData "pg_hba.conf"

if (-not (Test-Path "$pgData\PG_VERSION")) { exit 0 }
if (Test-Path $pgpassPath) { exit 0 }

# Password do .env, se ja la estiver (cluster migrado; so falta o .pgpass).
$pgPass = $null
$envText = if (Test-Path $envPath) { [IO.File]::ReadAllText($envPath) } else { "" }
$m = [regex]::Match($envText, 'postgresql://postgres:([^@\s]+)@')
if ($m.Success) { $pgPass = $m.Groups[1].Value }

# pg_hba ainda em trust → migrar. O trust permite o ALTER sem password.
if ((Test-Path $hba) -and
    ([IO.File]::ReadAllText($hba) -match '(?m)^[^#\r\n][^\r\n]*\btrust\b')) {
    if (-not $pgPass) {
        $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
        $pgPass = -join (1..24 | ForEach-Object { $chars[(Get-Random -Max $chars.Length)] })
    }
    & "$pgBin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc `
        "ALTER USER postgres PASSWORD '$pgPass'"
    if ($LASTEXITCODE -ne 0) { Write-Error "ALTER USER falhou"; exit 1 }
    $lines = [IO.File]::ReadAllLines($hba) | ForEach-Object {
        if ($_ -match '^\s*#') { $_ } else { $_ -replace '\btrust\b', 'scram-sha-256' }
    }
    [IO.File]::WriteAllLines($hba, $lines)
    & "$pgBin\pg_ctl.exe" -D $pgData reload | Out-Null
    # .env: meter a password no DATABASE_URL (so se ainda nao tiver).
    if ($envText -match 'postgresql://postgres@') {
        $envText = $envText -replace 'postgresql://postgres@',
            "postgresql://postgres:$pgPass@"
        [IO.File]::WriteAllText($envPath, $envText,
            (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-Output "Postgres migrado de trust para scram-sha-256."
}

# Nos dois caminhos (migrado ou so .pgpass perdido): repor o .pgpass.
if ($pgPass) {
    [IO.File]::WriteAllText($pgpassPath, "$pgPass`n",
        (New-Object System.Text.UTF8Encoding($false)))
}
exit 0

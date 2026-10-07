# gerar-env.ps1 (portable) — gera app\.env com segredos + DATABASE_URL para o Postgres portatil
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot # este script fica na raiz do bundle portatil
$envPath = Join-Path $root "app\.env"

if (Test-Path $envPath) { exit 0 } # ja existe — nao sobrescrever segredos

function New-Secret([int]$len = 48) {
    $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
    -join (1..$len | ForEach-Object { $chars[(Get-Random -Max $chars.Length)] })
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and
        $_.IPAddress -notmatch '^169\.254\.|^127\.'
    } | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "localhost" }

$adminPass = "braindead"
# Password do Postgres portatil — vai para o DATABASE_URL e para o
# app\.pgpass que o INICIAR.bat usa no initdb --pwfile e no psql.
$pgPass = New-Secret 24

$envContent = @"
# OficinaOS (portatil) — gerado automaticamente. NAO partilhar.
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=info

DATABASE_URL=postgresql://postgres:${pgPass}@127.0.0.1:5433/oficinaos

APP_URL=http://${ip}:4000
EXTRA_TRUSTED_ORIGINS=http://localhost:4000,http://127.0.0.1:4000

BETTER_AUTH_SECRET=$(New-Secret)
AI_ENCRYPTION_KEY=$(New-Secret)
COOKIE_SECRET=$(New-Secret)

SEED_ADMIN_PASSWORD=$adminPass

UPLOAD_DIR=./uploads
TZ=Europe/Lisbon
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, $envContent, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $root "app\.pgpass"), "$pgPass`n", $utf8NoBom)

$loginTxt = @"
OficinaOS — primeiro acesso
============================
Endereco neste PC : http://localhost:4000
Endereco na rede  : http://${ip}:4000
Utilizador        : admin
Palavra-passe     : $adminPass

A app obriga a trocar a palavra-passe no primeiro inicio de sessao.
"@
[System.IO.File]::WriteAllText((Join-Path $root "PRIMEIRO-LOGIN.txt"), $loginTxt, $utf8NoBom)

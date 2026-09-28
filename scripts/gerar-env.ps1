# gerar-env.ps1 — gera o .env do OficinaOS com segredos aleatorios e IP local
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\gerar-env.ps1
$ErrorActionPreference = "Stop"

function New-Secret([int]$len = 48) {
    $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
    -join (1..$len | ForEach-Object { $chars[(Get-Random -Max $chars.Length)] })
}

# IP local da rede (ignora adaptadores virtuais Docker/WSL/Hyper-V)
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and
        $_.IPAddress -notmatch '^169\.254\.|^127\.'
    } | Select-Object -First 1).IPAddress

if (-not $ip) { $ip = "localhost" }

$adminPass = New-Secret 20

$envContent = @"
# OficinaOS — gerado automaticamente pelo instalador. NAO partilhar.
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=info

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
[System.IO.File]::WriteAllText("$PWD\.env", $envContent, $utf8NoBom)

# Ficheiro com os dados do primeiro login (apagavel depois do 1o acesso)
$loginTxt = @"
OficinaOS — primeiro acesso
============================
Endereco neste PC : http://localhost:4000
Endereco na rede  : http://${ip}:4000
Utilizador        : admin
Palavra-passe     : $adminPass

A app obriga a trocar a palavra-passe no primeiro inicio de sessao.
Podes apagar este ficheiro depois de entrares.
"@
[System.IO.File]::WriteAllText("$PWD\PRIMEIRO-LOGIN.txt", $loginTxt, $utf8NoBom)

Write-Output "OFICINAOS_URL=http://${ip}:4000"
Write-Output "OFICINAOS_PASS=$adminPass"

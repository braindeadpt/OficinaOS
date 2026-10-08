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

# Sem credencial pre-definida: no 1o arranque (sem utilizadores) a app abre o
# ecra "Criar a sua oficina". Em Docker o browser do PC nao chega a app como
# 127.0.0.1, por isso esse ecra precisa deste codigo de uso unico (deixa de
# servir assim que a oficina e criada).
$setupToken = New-Secret 40

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

SETUP_TOKEN=$setupToken

UPLOAD_DIR=./uploads
TZ=Europe/Lisbon
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("$PWD\.env", $envContent, $utf8NoBom)

# Nota de primeiro acesso (apagavel depois de criar a oficina)
$loginTxt = @"
OficinaOS - primeiro acesso
============================
Endereco neste PC : http://localhost:4000
Endereco na rede  : http://${ip}:4000

Nao ha utilizador nem palavra-passe pre-definidos. Na primeira vez a app
abre o ecra "Criar a sua oficina": escolhe o nome da loja, o teu
utilizador e a tua palavra-passe.

Se o browser nao abrir esse ecra, usa esta ligacao neste PC (so serve
ate a oficina ser criada):
http://localhost:4000/setup?token=$setupToken

Podes apagar este ficheiro depois de criares a oficina.
"@
[System.IO.File]::WriteAllText("$PWD\PRIMEIRO-LOGIN.txt", $loginTxt, $utf8NoBom)

Write-Output "OFICINAOS_URL=http://${ip}:4000"
Write-Output "OFICINAOS_SETUP_URL=http://localhost:4000/setup?token=$setupToken"

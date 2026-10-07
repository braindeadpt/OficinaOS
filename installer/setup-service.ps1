# setup-service.ps1 — instala/remove os servicos OficinaOS (Postgres + app).
# Chamado pelo instalador Inno (post-install, uninstall e pre-upgrade) e pode
# ser re-corrido a mao a partir de <install>\tools. Requer elevacao.
#
# Layout instalado:
#   C:\Program Files\OficinaOS\        app\ bun\ pgsql\ tools\  (so leitura)
#   C:\ProgramData\OficinaOS\          data\ uploads\ backups\ logs\ (mutavel)
#
# Servicos:
#   OficinaOS-DB — Postgres portatil via pg_ctl register (arranque automatico)
#   OficinaOS    — app Bun via WinSW, depende de OficinaOS-DB
param(
    [switch]$Uninstall,  # remove servicos/regras (chamado pelo desinstalador)
    [switch]$Stop        # so parar — pre-upgrade, liberta os ficheiros em {app}
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot           # script fica em <install>\tools
$dataRoot = Join-Path $env:ProgramData "OficinaOS"
$pgData = Join-Path $dataRoot "data"
$pgBin = Join-Path $root "pgsql\bin"
$bun = Join-Path $root "bun\bun.exe"
$appDir = Join-Path $root "app"
$envPath = Join-Path $appDir ".env"
$winsw = Join-Path $root "tools\OficinaOS.exe"     # WinSW renomeado
$logDir = Join-Path $dataRoot "logs"

New-Item -ItemType Directory -Force $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir "setup.log") -Append | Out-Null

$svcDb = "OficinaOS-DB"
$svcApp = "OficinaOS"

function Stop-OurServices {
    foreach ($svc in @($svcApp, $svcDb)) {
        $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
        if ($s -and $s.Status -ne "Stopped") {
            Write-Output "A parar $svc..."
            Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
            $s.WaitForStatus("Stopped", (New-TimeSpan -Seconds 30))
        }
    }
}

function Remove-OurServices {
    if (Test-Path $winsw) {
        & $winsw uninstall 2>&1 | Out-Null
    }
    if (Get-Service -Name $svcDb -ErrorAction SilentlyContinue) {
        & "$pgBin\pg_ctl.exe" unregister -N $svcDb 2>&1 | Out-Null
        sc.exe delete $svcDb | Out-Null
    }
}

# ── Uninstall / Stop ────────────────────────────────────────────────────────
Stop-OurServices
if ($Stop) { Stop-Transcript | Out-Null; exit 0 }

if ($Uninstall) {
    Remove-OurServices
    Remove-NetFirewallRule -DisplayName "OficinaOS" -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName "OficinaOS Backup" -Confirm:$false `
        -ErrorAction SilentlyContinue
    Write-Output "Servicos e regras removidos. Dados ficam em $dataRoot"
    Stop-Transcript | Out-Null
    exit 0
}

# ── Install ──────────────────────────────────────────────────────────────────
Remove-OurServices  # reinstalacao limpa — os dados em $dataRoot ficam

foreach ($d in @($pgData, "$dataRoot\uploads", "$dataRoot\backups", $logDir)) {
    New-Item -ItemType Directory -Force $d | Out-Null
}

function New-Secret([int]$len = 48) {
    $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
    -join (1..$len | ForEach-Object { $chars[(Get-Random -Max $chars.Length)] })
}

# app\.env — segredos gerados uma vez; upgrades preservam o ficheiro
if (-not (Test-Path $envPath)) {
    $pgPass = New-Secret 24
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and
            $_.IPAddress -notmatch '^169\.254\.|^127\.'
        } | Select-Object -First 1).IPAddress

    # APP_URL usa o nome mDNS anunciado pela app — estavel mesmo que o IP mude.
    # O IP atual e o hostname ficam como origens extra (fallback sem mDNS).
    $extra = "http://localhost:4000,http://127.0.0.1:4000,http://$($env:COMPUTERNAME):4000"
    if ($ip) { $extra += ",http://${ip}:4000" }

    $envContent = @"
# OficinaOS — gerado pelo instalador. NAO partilhar.
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=info

DATABASE_URL=postgresql://postgres:${pgPass}@127.0.0.1:5433/oficinaos

APP_URL=http://oficinaos.local:4000
EXTRA_TRUSTED_ORIGINS=$extra
MDNS_HOSTNAME=oficinaos

BETTER_AUTH_SECRET=$(New-Secret)
AI_ENCRYPTION_KEY=$(New-Secret)
COOKIE_SECRET=$(New-Secret)

SEED_ADMIN_PASSWORD=braindead

UPLOAD_DIR=$dataRoot\uploads
TZ=Europe/Lisbon
"@
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($envPath, $envContent, $utf8NoBom)
    Write-Output "app\.env gerado."
}

# Password do postgres — instalacoes pre-v1.0.12 tinham auth=trust e o
# DATABASE_URL sem password: gera-se uma e mete-se no .env (o cluster ainda
# esta em trust neste ponto, por isso o ALTER USER abaixo nao precisa dela).
$pgPass = $null
if (Test-Path $envPath) {
    $m = [regex]::Match([IO.File]::ReadAllText($envPath),
        'postgresql://postgres:([^@\s]+)@')
    if ($m.Success) { $pgPass = $m.Groups[1].Value }
}
if (-not $pgPass) {
    $pgPass = New-Secret 24
    $envText = [IO.File]::ReadAllText($envPath)
    $envText = $envText -replace 'postgresql://postgres@',
        "postgresql://postgres:$pgPass@"
    [IO.File]::WriteAllText($envPath, $envText,
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "Password do Postgres gerada e guardada no .env."
}
$env:PGPASSWORD = $pgPass

# ACL: data\ (cluster) e backups\ (dumps) tem dados de clientes — fechar a
# Administrators/SYSTEM/NETWORK SERVICE (o ProgramData da leitura a Users
# por omissao). uploads\logs\ ficam com Users:M para o tray sem admin.
& icacls.exe $dataRoot /grant "SYSTEM:(OI)(CI)F" "NETWORK SERVICE:(OI)(CI)F" /t /c | Out-Null
foreach ($d in @($pgData, "$dataRoot\backups")) {
    & icacls.exe $d /inheritance:r /grant "Administrators:(OI)(CI)F" `
        "SYSTEM:(OI)(CI)F" "NETWORK SERVICE:(OI)(CI)F" /t /c | Out-Null
}
foreach ($d in @("$dataRoot\uploads", $logDir)) {
    & icacls.exe $d /grant "Users:(OI)(CI)M" /t /c | Out-Null
}
# app\.env tem todos os segredos (inclui a password do postgres) — Program
# Files deixa Users ler. So admins + contas de servico.
& icacls.exe $envPath /inheritance:r /grant "Administrators:F" "SYSTEM:F" `
    "NETWORK SERVICE:F" | Out-Null

# Postgres — initdb so na primeira vez (pasta ASCII, sem acentos).
# scram-sha-256 + --pwfile: sem o trust, nenhum processo local entra no
# Postgres sem a password do .env.
if (-not (Test-Path "$pgData\PG_VERSION")) {
    Write-Output "A inicializar a base de dados (primeira vez)..."
    $pwFile = New-TemporaryFile
    try {
        [IO.File]::WriteAllText($pwFile.FullName, "$pgPass`n",
            (New-Object System.Text.UTF8Encoding($false)))
        & "$pgBin\initdb.exe" -D $pgData -U postgres -E UTF8 --locale=C `
            --auth=scram-sha-256 "--pwfile=$($pwFile.FullName)" |
            Out-File (Join-Path $logDir "initdb.log") -Encoding utf8
    } finally {
        Remove-Item $pwFile.FullName -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path "$pgData\PG_VERSION")) {
        Write-Error "initdb falhou — ver $logDir\initdb.log"
    }
    Add-Content "$pgData\postgresql.conf" "`nlisten_addresses = '127.0.0.1'`nport = 5433"
}

& "$pgBin\pg_ctl.exe" register -N $svcDb -D $pgData -S auto | Out-Null
Start-Service -Name $svcDb

# Clusters pre-v1.0.12 com auth=trust → scram-sha-256. O trust ainda esta
# ativo aqui — o ALTER USER corre sem password antiga. Depois disto todas
# as ligacoes usam $env:PGPASSWORD (definido acima).
$hba = Join-Path $pgData "pg_hba.conf"
if ((Test-Path $hba) -and
    ([IO.File]::ReadAllText($hba) -match '(?m)^[^#\r\n][^\r\n]*\btrust\b')) {
    Write-Output "A migrar autenticacao do Postgres de trust para scram-sha-256..."
    & "$pgBin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc `
        "ALTER USER postgres PASSWORD '$pgPass'"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ALTER USER falhou — ver $logDir\setup.log"
    }
    $lines = [IO.File]::ReadAllLines($hba) | ForEach-Object {
        if ($_ -match '^\s*#') { $_ } else { $_ -replace '\btrust\b', 'scram-sha-256' }
    }
    [IO.File]::WriteAllLines($hba, $lines)
    & "$pgBin\pg_ctl.exe" -D $pgData reload | Out-Null
}

# base de dados da app — cria so se ainda nao existir
$dbExists = & "$pgBin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname='oficinaos'" 2>$null
if ($dbExists -notmatch "1") {
    & "$pgBin\createdb.exe" -h 127.0.0.1 -p 5433 -U postgres oficinaos | Out-Null
}

# App — WinSW instala OficinaOS.exe + OficinaOS.xml do mesmo diretorio
& $winsw install | Out-Null
# Com EAP=Stop um Start-Service falhado abortava o script — firewall, tarefa
# de backup e seed nunca corriam. O health check abaixo e que decide se a app
# esta realmente no ar; aqui so se regista a falha e segue.
try {
    Start-Service -Name $svcApp
} catch {
    Write-Output "Start-Service $svcApp falhou: $($_.Exception.Message) — o health check decide"
}

# Firewall — sem esta regra os tablets/telemoveis da loja nao ligam
Remove-NetFirewallRule -DisplayName "OficinaOS" -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "OficinaOS" -Direction Inbound -Protocol TCP `
    -LocalPort 4000 -Action Allow -Profile Any | Out-Null

# Backup diario as 03:30 como SYSTEM (o equivalente ao sidecar do Docker).
# schtasks /tr partia as aspas no PS 5.1 e a tarefa nunca era criada —
# os cmdlets agendam o mesmo sem parsing de linha de comando.
$backupPs1 = Join-Path $root "tools\backup.ps1"
$backupAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupPs1`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 03:30
Register-ScheduledTask -TaskName "OficinaOS Backup" -Action $backupAction `
    -Trigger $backupTrigger -User "SYSTEM" -RunLevel Highest -Force | Out-Null

# Esperar a app ficar pronta (migracoes correm no arranque via start:prod)
$ready = $false
for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    try {
        Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing `
            -TimeoutSec 3 | Out-Null
        $ready = $true
        break
    } catch { }
}
if (-not $ready) {
    Write-Error "A app nao respondeu em 3 minutos — ver $logDir\setup.log e $logDir\OficinaOS.*.log"
}

# Seed do admin (idempotente) + nota de primeiro acesso no Ambiente de Trabalho
# EAP=Continue localmente: no PS 5.1 o stderr de um nativo redirecionado com
# 2>&1 vira ErrorRecord e, com EAP=Stop, rebenta antes do exit code — o admin
# nunca era criado (o seed escreve progresso em stderr mesmo em sucesso).
$seedRc = 0
Push-Location $appDir
try {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $bun run db:seed 2>&1 | Out-Null
        $seedRc = $LASTEXITCODE
    } finally { $ErrorActionPreference = $eap }
} finally { Pop-Location }
if ($seedRc -ne 0) {
    Write-Error "db:seed falhou (exit $seedRc) — ver $logDir\setup.log"
}

$loginTxt = @"
OficinaOS — primeiro acesso
============================
Neste PC          : http://localhost:4000
Noutros aparelhos : http://oficinaos.local:4000
Utilizador        : admin
Palavra-passe     : braindead

A app obriga a trocar a palavra-passe no primeiro inicio de sessao.
"@
[System.IO.File]::WriteAllText(
    (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "PRIMEIRO-LOGIN.txt"),
    $loginTxt, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "Instalacao concluida — app pronta em http://localhost:4000"
Stop-Transcript | Out-Null

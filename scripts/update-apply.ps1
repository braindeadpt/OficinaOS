# update-apply.ps1 — aplica um update leve do OficinaOS com rollback automatico.
# E lancado via Win32_Process.Create (update-launch.ps1) ANTES de o servidor
# parar — fora da arvore do bun.exe, senao o stop matava o proprio script.
# Escreve o progresso em StatusPath para a app (nova ou antiga) ler.
#
# Fluxo: backup -> parar -> preservar .env/uploads -> trocar app\ ->
# arrancar -> health check -> se falhar, repoe app.prev, resolve migracoes
# falhadas (P3009) e arranca a antiga.
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$StatusPath,
  [Parameter(Mandatory = $true)][string]$BackupScript,
  [string]$HealthUrl = "http://localhost:4000/health",
  [string]$ServiceName = "OficinaOS",
  [int]$HealthTimeoutSec = 180
)

# Sem isto, um Copy-Item/Rename-Item que falhe a meio passa despercebido e o
# update continuava com ficheiros novos e velhos misturados.
$ErrorActionPreference = 'Stop'

# Resolver relativos ANTES de mudar de cwd: "-ZipPath .\app-update.zip"
# resolvia contra o TEMP em vez da pasta do chamador e o update nao
# encontrava o zip. StatusPath pode ainda nao existir — dai o
# GetUnresolvedProviderPathFromPSPath em vez de Resolve-Path.
$ZipPath      = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ZipPath)
$StatusPath   = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($StatusPath)
$BackupScript = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($BackupScript)
$InstallRoot  = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallRoot)

# cwd neutro: se o processo nascer com cwd dentro de InstallRoot\app (via
# Win32_Process.Create), o Rename-Item app->app.prev falha com "pasta em uso".
Set-Location $env:TEMP

$appDir  = Join-Path $InstallRoot 'app'
$prevDir = Join-Path $InstallRoot 'app.prev'
$keepDir = Join-Path $env:TEMP ('oficinaos-keep-' + [guid]::NewGuid().ToString('N'))
# Ficheiros mutaveis dentro de app\ que nao vem no zip de update.
$preserve = @('.env', '.pgpass', 'PRIMEIRO-LOGIN.txt', 'uploads')

# Log por passo: o status.json so guarda o ULTIMO estado — sem historico,
# uma falha a meio do swap nao deixava rasto nenhum. O pai do StatusPath e
# o staging (apagado a cada update), por isso o log fica no avo (workDir)
# e persiste entre updates. Nunca e fatal: o update nao pode morrer por
# causa do log.
$logPath = Join-Path (Split-Path (Split-Path $StatusPath -Parent) -Parent) 'update-apply.log'
function Write-Log([string]$msg) {
  try {
    $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    [IO.File]::AppendAllText($logPath, "$ts $msg`r`n")
  } catch { }
}

function Set-Status([string]$state, [string]$detail) {
  $body = @{
    state     = $state
    detail    = $detail
    updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StatusPath, $body)
  Write-Log "$state — $detail"
}

function Stop-AppProcesses {
  # So o bun DESTA instalacao: o prefixo com '\' final evita apanhar
  # C:\OficinaOS-outracoisa\bun.exe, e o CIM evita o acesso negado de
  # Get-Process .Path em processos de outras contas. O updater proprio
  # e powershell.exe fora desta arvore — nao se mata a si mesmo.
  $root = $InstallRoot.TrimEnd('\') + '\'
  Get-CimInstance Win32_Process -Filter "Name='bun.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Stop-OficinaOS {
  if ($Mode -eq 'service') {
    $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Stopped') {
      Stop-Service -Name $ServiceName -Force
      $w = 0
      while ((Get-Service $ServiceName).Status -ne 'Stopped' -and $w -lt 60) {
        Start-Sleep -Seconds 2; $w += 2
      }
      if ((Get-Service $ServiceName).Status -ne 'Stopped') {
        throw "o servico $ServiceName nao parou em 60s — update cancelado antes de mexer em ficheiros"
      }
    }
    Stop-AppProcesses
  } else {
    # Sentinel que impede o respawn do run-app.bat; depois mata o bun desta pasta.
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'STOP'), 'stopped')
    Stop-AppProcesses
  }
}

function Start-OficinaOS {
  if ($Mode -eq 'service') {
    Start-Service -Name $ServiceName
  } else {
    Remove-Item (Join-Path $InstallRoot 'STOP') -Force -ErrorAction SilentlyContinue
    Start-Process cmd -ArgumentList '/c', "`"$InstallRoot\run-app.bat`"" -WindowStyle Hidden
  }
}

function Test-Healthy([int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return $true }
    } catch { Start-Sleep -Seconds 3 }
  }
  return $false
}

function Restore-Preserved {
  foreach ($item in $preserve) {
    $src = Join-Path $keepDir $item
    if (-not (Test-Path $src)) { continue }
    $dst = Join-Path $appDir $item
    if (Test-Path $src -PathType Container) {
      # Copia o CONTEUDO da pasta para dentro do destino — no PS 5.1,
      # Copy-Item dir->dir existente aninhava ($dst\uploads\uploads).
      New-Item -ItemType Directory -Force $dst | Out-Null
      Copy-Item (Join-Path $src '*') $dst -Recurse -Force
    } else {
      Copy-Item $src $dst -Force
    }
  }
  # Service mode: o .env re-posto herda a ACL de Program Files (Users leem).
  # Fechar como o setup-service.ps1 faz — so admins + contas de servico.
  if ($Mode -eq 'service') {
    $envFile = Join-Path $appDir '.env'
    if (Test-Path $envFile) {
      & icacls.exe $envFile /inheritance:r /grant "Administrators:F" "SYSTEM:F" `
        "NETWORK SERVICE:F" | Out-Null
    }
  }
}

function Resolve-FailedMigrations {
  # Uma migracao que falhou a meio fica com uma linha "em curso" em
  # _prisma_migrations e QUALQUER `migrate deploy` rebenta com P3009 —
  # sem isto, a versao antiga tambem nao arrancava no rollback.
  $envFile = Join-Path $appDir '.env'
  $psql    = Join-Path $InstallRoot 'pgsql\bin\psql.exe'
  $bun     = Join-Path $InstallRoot 'bun\bun.exe'
  if (-not ((Test-Path $envFile) -and (Test-Path $psql) -and (Test-Path $bun))) { return }
  $line = Get-Content $envFile |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
  if (-not $line) { return }
  $dbUrl = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
  if (-not $dbUrl) { return }
  # stderr de comandos nativos (psql, prisma) com EAP=Stop pode virar
  # NativeCommandError — relaxa-se so nestas chamadas.
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $failed = & $psql $dbUrl -t -A -c `
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" 2>$null
    $psqlOk = ($LASTEXITCODE -eq 0)
    $env:DATABASE_URL = $dbUrl
    Push-Location $appDir
    try {
      if ($psqlOk) {
        foreach ($m in $failed) {
          $name = $m.Trim()
          if ($name) { & $bun x prisma migrate resolve --rolled-back $name 2>&1 | Out-Null }
        }
      }
    } finally { Pop-Location }
  } finally { $ErrorActionPreference = $eap }
}

function Restore-Previous([string]$reason) {
  Set-Status 'rolling_back' $reason
  Stop-OficinaOS
  # Sem app.prev nao ha nada para repor — apagar app\ destruía a instalacao
  # e o status ficava a mentir ("rolled_back" sem nada reposto).
  if (-not (Test-Path $prevDir)) {
    throw "rollback impossivel: $prevDir nao existe — app\ mantida como esta"
  }
  if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force -ErrorAction Stop }
  Rename-Item $prevDir $appDir -ErrorAction Stop
  Restore-Preserved
  Resolve-FailedMigrations
  Start-OficinaOS
  Set-Status 'rolled_back' $reason
}

try {
  # 1. Backup (DB ainda a correr — pg_dump funciona com a app no ar)
  Set-Status 'backing_up' 'A guardar a base de dados antes de atualizar'
  # EAP relaxado aqui: stderr de nativos dentro do backup nao pode virar throw.
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $BackupScript 2>&1 | Out-Null
    $backupRc = $LASTEXITCODE
  } finally { $ErrorActionPreference = $eap }
  if ($backupRc -ne 0) { throw "backup falhou (exit $backupRc) — update cancelado" }

  # 2. Parar
  Set-Status 'stopping' 'A parar o OficinaOS'
  Stop-OficinaOS

  # 3. Preservar ficheiros mutaveis
  New-Item -ItemType Directory -Force $keepDir | Out-Null
  foreach ($item in $preserve) {
    $src = Join-Path $appDir $item
    if (Test-Path $src) { Copy-Item $src (Join-Path $keepDir $item) -Recurse -Force }
  }

  # 4. Trocar app\ (mantem app.prev para rollback)
  Set-Status 'applying' 'A instalar a nova versao'
  if (Test-Path $prevDir) { Remove-Item $prevDir -Recurse -Force }
  # O swap so existe se o rename tiver saido bem — sem a flag, um rename
  # falhado (ficheiro bloqueado, antivirus, Explorer aberto em app\) fazia o
  # catch APAGAR a app\ original intacta, e com app.prev inexistente nada
  # era reposto: instalacao destruida com status "versao anterior reposta".
  $swapped = $false
  try {
    # O rename fica DENTRO do try: se falhar (pasta em uso / cwd em app\),
    # o catch repoe o estado e arranca o servico em vez de o deixar parado.
    Rename-Item $appDir $prevDir -ErrorAction Stop
    $swapped = $true
    # O zip contem a pasta app\ — extrai para o root e recria app\.
    # Expand-Archive do PS 5.1 falha em zips criados com `tar -a -cf`
    # ("Cannot find path ...\app\.bun-version") e demorava ~450-640s.
    # tar.exe (bsdtar) vem no Windows 10+; ZipFile fica como fallback.
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path $tarExe) {
      & $tarExe -xf $ZipPath -C $InstallRoot
      if ($LASTEXITCODE -ne 0) { throw "tar -xf falhou (exit $LASTEXITCODE)" }
    } else {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $InstallRoot)
    }
    Restore-Preserved
  } catch {
    $msg = $_.Exception.Message
    Write-Log "swap falhou: $msg (swapped=$swapped)"
    # So ha algo para repor se o swap chegou a acontecer — app\ intacta
    # (rename falhou) nao se toca, app\ parcial (extracao falhou) e limpa
    # e o app.prev volta ao lugar.
    if ($swapped) {
      try {
        if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
        if (Test-Path $prevDir) { Rename-Item $prevDir $appDir }
        Restore-Preserved
        Write-Log 'app.prev reposto apos falha na extracao'
      } catch { Write-Log "reposicao falhou: $($_.Exception.Message)" }
    }
    # O rearranque tenta SEMPRE — mesmo que a reposicao falhe a meio.
    try { Start-OficinaOS } catch { }
    $outcome = if ($swapped) { 'versao anterior reposta' } else { 'versao anterior intacta' }
    throw "extracao falhou: $msg — $outcome"
  }

  # 5. Arrancar + health check (migracoes correm no arranque)
  Set-Status 'restarting' 'A arrancar a nova versao (migracoes incluidas)'
  Start-OficinaOS
  if (-not (Test-Healthy $HealthTimeoutSec)) {
    Restore-Previous 'a nova versao nao respondeu no /health — rollback automatico'
    exit 0
  }

  # 6. Sucesso
  Set-Status 'done' 'Atualizacao concluida'
} catch {
  Set-Status 'failed' $_.Exception.Message
  exit 1
} finally {
  Remove-Item $keepDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
}

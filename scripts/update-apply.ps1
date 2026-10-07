# update-apply.ps1 — aplica um update leve do OficinaOS com rollback automatico.
# E spawnado detached pelo servidor ANTES de ele parar (a app nao se pode
# substituir a si propria em runtime). Escreve o progresso em StatusPath
# para a app (nova ou antiga) ler quando voltar.
#
# Fluxo: backup -> parar -> preservar .env/uploads -> trocar app\ ->
# arrancar -> health check -> se falhar, repoe app.prev e arranca a antiga.
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

$appDir  = Join-Path $InstallRoot 'app'
$prevDir = Join-Path $InstallRoot 'app.prev'
$keepDir = Join-Path $env:TEMP ('oficinaos-keep-' + [guid]::NewGuid().ToString('N'))
# Ficheiros mutaveis dentro de app\ que nao vem no zip de update.
$preserve = @('.env', 'PRIMEIRO-LOGIN.txt', 'uploads')

function Set-Status([string]$state, [string]$detail) {
  $body = @{
    state     = $state
    detail    = $detail
    updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StatusPath, $body)
}

function Stop-OficinaOS {
  if ($Mode -eq 'service') {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    $w = 0
    while ((Get-Service $ServiceName).Status -ne 'Stopped' -and $w -lt 60) {
      Start-Sleep -Seconds 2; $w += 2
    }
  } else {
    # Sentinel que impede o respawn do run-app.bat; depois mata o bun desta pasta.
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'STOP'), 'stopped')
    Get-Process bun -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -like "$InstallRoot*" } | Stop-Process -Force
  }
}

function Start-OficinaOS {
  if ($Mode -eq 'service') {
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
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
    if (Test-Path $src) {
      Copy-Item $src (Join-Path $appDir $item) -Recurse -Force
    }
  }
}

function Restore-Previous([string]$reason) {
  Set-Status 'rolling_back' $reason
  Stop-OficinaOS
  if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
  Rename-Item $prevDir $appDir
  Restore-Preserved
  Start-OficinaOS
  Set-Status 'rolled_back' $reason
}

try {
  # 1. Backup (DB ainda a correr — pg_dump funciona com a app no ar)
  Set-Status 'backing_up' 'A guardar a base de dados antes de atualizar'
  & $BackupScript 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "backup falhou (exit $LASTEXITCODE) — update cancelado" }

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
  Rename-Item $appDir $prevDir
  try {
    # O zip contem a pasta app\ — extrai para o root e recria app\
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $InstallRoot -Force
    Restore-Preserved
  } catch {
    if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
    Rename-Item $prevDir $appDir
    Restore-Preserved
    Start-OficinaOS
    throw "extracao falhou: $($_.Exception.Message) — versao anterior reposta"
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

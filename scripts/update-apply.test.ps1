# update-apply.test.ps1 — prova de robustez do updater (corre com pwsh/powershell 5.1+).
#
# Cenario A (regressao): um handle exclusivo num ficheiro de app\ faz o
#   rename app->app.prev falhar. A instalacao TEM de ficar intacta — sem
#   a flag $swapped, o catch apagava a app\ original (so sobrava o ficheiro
#   bloqueado) e, com app.prev inexistente, nada era reposto.
# Cenario B: ciclo completo com o health check a falhar — o rollback repoe
#   a versao anterior e os ficheiros preservados.
#
# Exit 0 = tudo passou; 1 = falhou (lista de falhas no stdout).
# Corre localmente e no .github/workflows/updater-check.yml.

$ErrorActionPreference = 'Stop'
$applyScript = Join-Path $PSScriptRoot 'update-apply.ps1'
$failures = [System.Collections.Generic.List[string]]::new()

function Assert([bool]$cond, [string]$name) {
  if ($cond) { Write-Host "  PASS $name" } else {
    Write-Host "  FAIL $name" -ForegroundColor Red
    $script:failures.Add($name)
  }
}

function New-FakeInstall([string]$root) {
  New-Item -ItemType Directory -Force "$root\app", "$root\data\update", "$root\src\app" | Out-Null
  Set-Content "$root\app\version.txt" 'v-old'
  Set-Content "$root\app\.env" 'SECRET=1'
  Set-Content "$root\app\zzz.dll" 'dll'
  Set-Content "$root\run-app.bat" '@echo off'
  Set-Content "$root\backup.ps1" 'exit 0'
  Set-Content "$root\src\app\version.txt" 'v-new'
  Compress-Archive -Path "$root\src\app" -DestinationPath "$root\data\update\app-update.zip" -Force
}

function Invoke-Updater([string]$root) {
  # HealthUrl numa porta morta — um /health real noutra porta desta maquina
  # nao pode fazer passar o health check por acidente.
  powershell -NoProfile -ExecutionPolicy Bypass -File $applyScript `
    -Mode portable -InstallRoot $root `
    -ZipPath "$root\data\update\app-update.zip" `
    -StatusPath "$root\data\update\status.json" `
    -BackupScript "$root\backup.ps1" `
    -HealthUrl 'http://localhost:9/health' -HealthTimeoutSec 3
  return $LASTEXITCODE
}

# ---------- Cenario A: ficheiro bloqueado durante o swap ----------
Write-Host 'A) rename falha por ficheiro bloqueado — instalacao intacta'
$rootA = Join-Path $env:TEMP ('oficinaos-test-a-' + [guid]::NewGuid().ToString('N'))
New-FakeInstall $rootA
$lock = [IO.File]::Open("$rootA\app\zzz.dll", 'Open', 'ReadWrite', 'None')
$rcA = Invoke-Updater $rootA
$lock.Close()

$statusA = Get-Content "$rootA\data\update\status.json" -Raw | ConvertFrom-Json
Assert ($rcA -eq 1) 'A: exit code 1 (update abortou)'
Assert ($statusA.state -eq 'failed') "A: status failed (era $($statusA.state))"
Assert ((Get-Content "$rootA\app\version.txt" -ErrorAction SilentlyContinue) -eq 'v-old') 'A: version.txt continua v-old'
Assert ((Get-Content "$rootA\app\.env" -ErrorAction SilentlyContinue) -eq 'SECRET=1') 'A: .env intacto'
Assert (Test-Path "$rootA\app\zzz.dll") 'A: zzz.dll intacta'
Assert ((Get-ChildItem "$rootA\app" -Force).Count -eq 3) 'A: app\ sem ficheiros extra/apagados'
Assert ($statusA.detail -like '*intacta*') "A: status honesto — '$($statusA.detail)'"

# ---------- Cenario B: health check falha — rollback repoe tudo ----------
Write-Host 'B) health check falha — rollback repoe a versao anterior'
$rootB = Join-Path $env:TEMP ('oficinaos-test-b-' + [guid]::NewGuid().ToString('N'))
New-FakeInstall $rootB
$rcB = Invoke-Updater $rootB

$statusB = Get-Content "$rootB\data\update\status.json" -Raw | ConvertFrom-Json
Assert ($rcB -eq 0) "B: exit code 0 (rollback e sucesso operacional — era $rcB)"
Assert ($statusB.state -eq 'rolled_back') "B: status rolled_back (era $($statusB.state))"
Assert ((Get-Content "$rootB\app\version.txt" -ErrorAction SilentlyContinue) -eq 'v-old') 'B: version.txt reposto para v-old'
Assert ((Get-Content "$rootB\app\.env" -ErrorAction SilentlyContinue) -eq 'SECRET=1') 'B: .env preservado'
Assert (Test-Path "$rootB\app\zzz.dll") 'B: zzz.dll reposta'
Assert (-not (Test-Path "$rootB\app.prev")) 'B: app.prev consumido pelo rollback'

# ---------- Log por passo ----------
$logA = "$rootA\data\update-apply.log"
Assert (Test-Path $logA) 'log: update-apply.log existe no workDir'
if (Test-Path $logA) {
  Assert (((Get-Content $logA) | Where-Object { $_ -match 'backing_up|applying|failed' }).Count -ge 3) 'log: passos registados'
}

Remove-Item $rootA, $rootB -Recurse -Force -ErrorAction SilentlyContinue
if ($failures.Count -gt 0) {
  Write-Host "`n$($failures.Count) falha(s): $($failures -join '; ')" -ForegroundColor Red
  exit 1
}
Write-Host "`nTodos os cenarios passaram"
exit 0

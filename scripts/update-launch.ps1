# update-launch.ps1 — arranca o update-apply.ps1 FORA da arvore de processos
# do bun. No Windows, `spawn detached` nao muda o pai: se o updater ficasse
# filho do bun.exe, o Stop-Service/Stop-Process que ele proprio corre
# matava-o a meio da atualizacao. Via Win32_Process.Create o processo nasce
# filho do WmiPrvSE e corre com o token do chamador (SYSTEM no modo servico,
# o utilizador no modo portatil).
param(
  [Parameter(Mandatory = $true)][string]$CommandLine,
  [Parameter(Mandatory = $true)][string]$StatusPath
)

function Set-Status([string]$state, [string]$detail) {
  $body = @{
    state     = $state
    detail    = $detail
    updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StatusPath, $body)
}

try {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
    -Arguments @{ CommandLine = $CommandLine }
  if ($r.ReturnValue -ne 0) {
    throw "Win32_Process.Create devolveu $($r.ReturnValue)"
  }
} catch {
  Set-Status 'failed' "nao foi possivel lancar o updater: $($_.Exception.Message)"
  exit 1
}

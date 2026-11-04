# recover-access.ps1 — corre ELEVADO (UAC) a partir do tray OficinaOS.
# O pedido de elevação é a prova de acesso físico ao servidor.
# Fluxo: lista contas OWNER → diálogo de escolha → bun recover-access
# --user → mostra a password temporária uma vez, com botão Copiar.
# A password nunca é escrita em ficheiro nem log — fica só nesta consola/
# memória do processo.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$tools = Split-Path -Parent $PSCommandPath
$root  = Split-Path -Parent $tools
$app   = Join-Path $root "app"
$bun   = Join-Path $root "bun\bun.exe"

function Fail($msg) {
    [System.Windows.Forms.MessageBox]::Show(
        $msg, "OficinaOS — Recuperar acesso",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    exit 1
}

# Demo mode: recuperação desativada (igual às rotas de gestão).
$envFile = Join-Path $app ".env"
if ((Test-Path $envFile) -and
    (Select-String -Path $envFile -Pattern '^\s*DEMO_MODE\s*=\s*true' -Quiet)) {
    Fail "Recuperação de acesso desativada em modo demo."
}

if (-not (Test-Path $bun)) { Fail "bun.exe não encontrado em $bun" }

function Invoke-Recover($extraArgs) {
    # PS 5.1: stderr de um nativo combinado com 2>&1 + EAP=Stop vira
    # ErrorRecord terminante ANTES de devolver a saída (o bun escreve
    # progresso em stderr mesmo em sucesso) — o mesmo padrão do
    # setup-service.ps1 no db:seed. EAP=Continue aqui; o exit code
    # distingue falha real de texto informativo.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $bun run --cwd $app recover-access -- @extraArgs 2>&1 |
            Out-String
        $rc = $LASTEXITCODE
    } finally { $ErrorActionPreference = $eap }
    return @{ Text = $out; Rc = $rc }
}

# ── 1. Lista de contas OWNER (inativas marcadas) ────────────────────────
$list = Invoke-Recover @()
if ($list.Rc -ne 0) { Fail "Falha ao listar contas.`n`n$($list.Text)" }
$users = @()
foreach ($line in ($list.Text -split "`r?`n")) {
    # Linhas de utilizador vêm com indentação: "  user (Nome) — inativa".
    if ($line -match '^\s{2,}(\S+)') {
        $uname = $Matches[1]
        if ($uname -eq "Para") { continue }
        # Mostra o marcador; o login para o script é só o primeiro token.
        $display = $line.Trim()
        $users += ,@{ Username = $uname; Display = $display }
    }
}
if ($users.Count -eq 0) {
    Fail "Nenhuma conta OWNER encontrada.`n`n$($list.Text)"
}

# ── 2. Escolha do utilizador ────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "OficinaOS — Recuperar acesso"
$form.Width = 420; $form.Height = 300
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = "Escolha a conta de dono/administrador a repor:"
$lbl.Left = 15; $lbl.Top = 15; $lbl.Width = 370
$form.Controls.Add($lbl)

$lst = New-Object System.Windows.Forms.ListBox
$lst.Left = 15; $lst.Top = 45; $lst.Width = 370; $lst.Height = 150
$lst.Items.AddRange([object[]]($users | ForEach-Object { $_.Display }))
if ($users.Count -eq 1) { $lst.SelectedIndex = 0 }
$form.Controls.Add($lst)

$ok = New-Object System.Windows.Forms.Button
$ok.Text = "Repor password"; $ok.DialogResult = "OK"
$ok.Left = 205; $ok.Top = 210; $ok.Width = 180; $ok.Height = 32
$form.Controls.Add($ok)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancelar"; $cancel.DialogResult = "Cancel"
$cancel.Left = 15; $cancel.Top = 210; $cancel.Width = 120; $cancel.Height = 32
$form.Controls.Add($cancel)
$form.AcceptButton = $ok; $form.CancelButton = $cancel

if ($form.ShowDialog() -ne "OK" -or -not $lst.SelectedItem) { exit 0 }
# O item da lista pode trazer "(nome) — inativa"; o username é o 1º token.
$user = $lst.SelectedItem.ToString().Split(' ')[0]

# ── 3. Reset (com reativação opcional se a conta estiver inativa) ───────
function Run-Reset($reactivate) {
    if ($reactivate) { return Invoke-Recover @("--user", $user, "--reactivate") }
    return Invoke-Recover @("--user", $user)
}

$res = Run-Reset $false
if ($res.Text -match '--reactivate') {
    $r = [System.Windows.Forms.MessageBox]::Show(
        "A conta ""$user"" está inativa. Reativar e repor a password?",
        "OficinaOS — Recuperar acesso",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($r -ne "Yes") { exit 0 }
    $res = Run-Reset $true
}
if ($res.Rc -ne 0) {
    Fail "Não foi possível repor a password.`n`n$($res.Text)"
}

# A linha a seguir a "Palavra-passe temporária para ..." é a password.
$password = $null
$lines = $res.Text -split "`r?`n"
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'Palavra-passe tempor') {
        $password = $lines[$i + 1].Trim()
        break
    }
}
if (-not $password) { Fail "Não foi possível repor a password.`n`n$($res.Text)" }

# ── 4. Mostrar uma vez + Copiar ─────────────────────────────────────────
$res = New-Object System.Windows.Forms.Form
$res.Text = "OficinaOS — Password temporária"
$res.Width = 460; $res.Height = 240
$res.StartPosition = "CenterScreen"
$res.FormBorderStyle = "FixedDialog"
$res.MaximizeBox = $false

$l2 = New-Object System.Windows.Forms.Label
$l2.Text = "Password temporária para $user — vai ter de a mudar no primeiro login:"
$l2.Left = 15; $l2.Top = 15; $l2.Width = 410
$res.Controls.Add($l2)

$tb = New-Object System.Windows.Forms.TextBox
$tb.Left = 15; $tb.Top = 45; $tb.Width = 410
$tb.ReadOnly = $true; $tb.Text = $password
$tb.Font = New-Object System.Drawing.Font("Consolas", 12)
$res.Controls.Add($tb)

$cp = New-Object System.Windows.Forms.Button
$cp.Text = "Copiar"; $cp.Left = 15; $cp.Top = 95; $cp.Width = 180; $cp.Height = 32
$cp.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($tb.Text); $cp.Text = "Copiado!" })
$res.Controls.Add($cp)
$cls = New-Object System.Windows.Forms.Button
$cls.Text = "Fechar"; $cls.DialogResult = "OK"
$cls.Left = 245; $cls.Top = 95; $cls.Width = 180; $cls.Height = 32
$res.Controls.Add($cls)
$res.AcceptButton = $cls

$res.ShowDialog() | Out-Null

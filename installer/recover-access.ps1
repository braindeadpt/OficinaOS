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
    $out = & $bun run --cwd $app recover-access -- @extraArgs 2>&1
    return ($out | Out-String)
}

# ── 1. Lista de contas OWNER ────────────────────────────────────────────
$listText = Invoke-Recover @()
$users = @()
foreach ($line in ($listText -split "`r?`n")) {
    if ($line -match '^\s+(\S+)\s*(\(.*\))?\s*$' -and $Matches[1] -ne "Para") {
        $users += $Matches[1]
    }
}
if ($users.Count -eq 0) { Fail "Nenhuma conta OWNER ativa encontrada.`n`n$listText" }

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
$lst.Items.AddRange([object[]]$users)
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
$user = $lst.SelectedItem.ToString()

# ── 3. Reset (com reativação opcional se a conta estiver inativa) ───────
function Run-Reset($reactivate) {
    if ($reactivate) { return Invoke-Recover @("--user", $user, "--reactivate") }
    return Invoke-Recover @("--user", $user)
}

$out = Run-Reset $false
if ($out -match '--reactivate') {
    $r = [System.Windows.Forms.MessageBox]::Show(
        "A conta ""$user"" está inativa. Reativar e repor a password?",
        "OficinaOS — Recuperar acesso",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($r -ne "Yes") { exit 0 }
    $out = Run-Reset $true
}

# A linha a seguir a "Palavra-passe temporária para ..." é a password.
$password = $null
$lines = $out -split "`r?`n"
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'Palavra-passe tempor') {
        $password = $lines[$i + 1].Trim()
        break
    }
}
if (-not $password) { Fail "Não foi possível repor a password.`n`n$out" }

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

# Instalador Windows (`OficinaOS-Setup.exe`)

Instalação "à Windows" para PCs de balcão: um `.exe` único que instala a app
como serviços — sem Docker, sem janelas de consola, sem admin depois de
instalado. Construído em CI por `.github/workflows/release.yml` (job `setup`)
em cima do bundle portátil (Bun + PostgreSQL + app já compilados).

## O que instala

| Peça | Destino |
|---|---|
| Binários (app, `bun`, `pgsql`, `tools`) | `C:\Program Files\OficinaOS` — só leitura |
| Estado (BD, uploads, backups, logs) | `C:\ProgramData\OficinaOS` — mutável |
| Serviço `OficinaOS-DB` | Postgres via `pg_ctl register`, arranque automático |
| Serviço `OficinaOS` | app via WinSW (`tools\OficinaOS.exe` + `.xml`), depende do DB |
| `OficinaOSTray` | ícone na bandeja (HKLM Run): Abrir / Estado / Backup / Parar / Reiniciar |
| Firewall | regra inbound TCP 4000 — sem ela os tablets da loja não ligam |
| Tarefa `OficinaOS Backup` | `backup.ps1` diário às 03:30 como SYSTEM |

`.env` é gerado uma vez em `app\.env` com `APP_URL=http://oficinaos.local:4000`
— o nome é anunciado por mDNS (`MDNS_HOSTNAME=oficinaos`), logo tablets e
telemóveis ligam sempre ao mesmo endereço mesmo que o router mude o IP do PC.

## Desinstalar

Remove serviços, regra de firewall, tarefa de backup e ficheiros; pergunta se
apaga `C:\ProgramData\OficinaOS` (BD + backups). "Não" = upgrade posterior
reaproveita os dados.

## Assinatura de código

O `.exe` sai não-assinado → SmartScreen avisa "editores desconhecidos".
Caminho planeado: **SignPath** (assinatura grátis para OSS — o repo é MIT).
Enquanto não estiver, a página de download no site mostra o SHA-256 e a
instrução "Mais informações → Executar mesmo assim".

## Build local (dev)

Requer Inno Setup 6 e o bundle portátil montado em `installer\stage\`
(`app\ bun\ pgsql\ tools\` + `OficinaOS.ico` na raiz de `installer\`):

```powershell
# compilar o tray
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe `
  /win32icon:installer\OficinaOS.ico /out:installer\stage\tools\OficinaOSTray.exe `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll installer\tray\OficinaOSTray.cs

# compilar o instalador
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" /DMyAppVersion=dev installer\oficinaos.iss
# sai em dist\OficinaOS-Setup-dev.exe
```

`setup-service.ps1` é idempotente — corre à mão (`-Uninstall` para remover
serviços, `-Stop` para parar antes de mexer nos ficheiros).

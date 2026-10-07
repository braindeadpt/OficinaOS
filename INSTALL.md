# Instalar o OficinaOS — passo a passo

Guia para Windows. Demora ~10 minutos na primeira vez.

## Requisitos

| Requisito | Detalhe |
|---|---|
| **PC** | Windows 10/11 **64-bit** — o PC que fica ligado na loja |
| **RAM** | 4 GB livres |
| **Disco** | ~3 GB livres (app + base de dados + backups) |
| **Permissões** | Administrador, só durante a instalação pelo `OficinaOS-Setup.exe` — sem admin usa a **instalação portátil** |
| **Internet** | Só na **primeira instalação** e para atualizar — depois funciona offline na rede local |
| **Outros dispositivos** | **Nada** — só um browser |

## Cenários de uso

| Cenário | Como funciona |
|---|---|
| **1. Um só PC** (o mais simples) | Instalas no PC do balcão e usas `http://localhost:4000` nesse mesmo PC |
| **2. PC-servidor + vários dispositivos** | O mesmo PC corre a app; tablets, telemóveis e outros PCs abrem `http://<IP>:4000` no browser — sem instalar nada. ⚠️ A app só funciona enquanto esse PC estiver ligado |
| **3. Máquina dedicada** | Um mini-PC ou NAS com Docker sempre ligado corre a app; todos acedem por browser. Ideal para não depender do PC do balcão |
| **4. Acesso pela internet** | Cloudflare Tunnel grátis — HTTPS automático, sem abrir portas no router, funciona com CGNAT. Guia: **[docs/remote-access.md](docs/remote-access.md)**. Também dá links públicos aos clientes (tracking, orçamentos, QR de garantia) |

## Instalação recomendada — `OficinaOS-Setup.exe`

O caminho mais simples para um PC de balcão: um instalador Windows normal que
deixa o OficinaOS a correr como serviço — **sem Docker, sem janelas de consola,
arranca sozinho com o PC**.

1. Descarrega **[OficinaOS-Setup](https://github.com/braindeadpt/OficinaOS/releases/latest)** (ficheiro `OficinaOS-Setup-*.exe` na release mais recente)
2. Duplo clique → se o SmartScreen avisar: **Mais informações → Executar mesmo assim**
3. Pede administrador **uma vez** (serviços + firewall) e no fim a app abre no browser
4. Fica um **ícone na bandeja** junto ao relógio: abrir a app, ver o estado, fazer backup, parar/arrancar

Depois da instalação:

- **Neste PC:** `http://localhost:4000`
- **Noutros aparelhos da loja** (tablet, telemóvel): `http://oficinaos.local:4000` — nome estável que funciona mesmo que o PC mude de IP. A página **Ajuda → QR code** tem um código para apontar com a câmara e ligar sem escrever nada
- **Atualizar:** quando a app avisar que existe versão nova, o dono da loja (admin) tem um botão **"Atualizar"** no aviso — descarrega só a parte da app (~100 MB em vez de ~600 MB), faz backup da base de dados antes e, se a nova versão não arrancar, repõe automaticamente a anterior. Também podes atualizar à mão: descarrega o `OficinaOS-Setup` da versão nova e corre por cima — os dados ficam
- **Backups automáticos:** diário às 03:30 para `C:\ProgramData\OficinaOS\backups` (copia para uma pen/disco externo com regularidade)
- **Desinstalar:** "Aplicações" nas Definições do Windows — pergunta se queres apagar também os dados

Documentação técnica do instalador: [installer/README.md](installer/README.md)

## Instalação via Docker (alternativa)

Para NAS, servidores ou quem já usa Docker.

### 1. Descarregar

1. Descarrega o instalador: **[oficinaos-install.zip](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-install.zip)** — este link descarrega sempre a versão mais recente
2. Extrai o ZIP para uma pasta, ex.: `C:\OficinaOS`

> Alternativa: na página do GitHub, botão verde **Code → Download ZIP** dá o código completo (mais pesado — usa-o só se o instalador falhar).

### 2. Instalar

1. Dentro da pasta, **duplo clique em `INSTALAR.bat`**
2. Se o Windows Defender SmartScreen avisar: **Mais informações → Executar mesmo assim**
3. O instalador faz tudo sozinho:
   - Instala o **Docker Desktop** se não existir (gratuito, oficial)
   - Gera as passwords e segredos automaticamente
   - **Descarrega a imagem pronta do GitHub** (segundos) — se falhar, descarrega o código-fonte e constrói localmente (~5-10 min; fica em `oficinaos-src\app-source` para os `INICIAR`/`PARAR`/`ATUALIZAR` funcionarem depois)
4. No fim, o browser abre automaticamente em `http://localhost:4000`

> **Se o Windows pedir para reiniciar** durante a instalação do Docker (é normal), reinicia o PC e volta a correr `INSTALAR.bat`.

## 3. Primeiro login

- **Utilizador:** `admin`
- **Palavra-passe:** `braindead`

No primeiro acesso a app **obriga a definir um novo nome de utilizador e uma nova palavra-passe** — escolhe os teus e guarda-os. Depois disso, `admin`/`braindead` deixa de funcionar.

## 4. Uso diário

| Ficheiro | Para quê |
|---|---|
| `INICIAR.bat` | Ligar o OficinaOS (duplo clique — abre o browser) |
| `PARAR.bat` | Desligar (os dados ficam guardados) |
| `ATUALIZAR.bat` | Atualizar para a versão mais recente |

**Outros dispositivos da loja** (tablet, telemóvel do técnico, outro PC): abrir `http://<IP-do-PC>:4000` — o endereço exato está no `PRIMEIRO-LOGIN.txt`. Não precisam de instalar nada.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| O firewall do Windows pergunta se permite o acesso | Escolher **Permitir** (rede privada) |
| Página em branco no browser | `Ctrl+F5`; se persistir, confirmar que usaste `http://` e não `https://` |
| "Invalid username or password" | O login é por **username** (`admin`), não email |
| O PC mudou de IP e os outros dispositivos deixaram de ligar | Apagar o ficheiro `.env`, correr `INSTALAR.bat` outra vez (gera config nova; os dados mantêm-se) |
| "Virtualization support not detected" / Docker não arranca | O `INSTALAR.bat` deteta isto e oferece alternativa — ver **Instalação portátil** abaixo |
| Desinstalar por completo | `docker compose down -v` na pasta + apagar a pasta (⚠️ apaga a base de dados) |

## Instalação portátil (sem admin, sem instalar nada)

O `OficinaOS-Setup.exe` é o caminho recomendado — mas o **modo portátil** existe para as situações em que o instalador não serve:

- **Sem administrador** — não tens a password de admin do PC da loja (o Setup precisa dela para serviços e firewall; o portátil não precisa de nada)
- **Não queres instalar nada** — nada fica registado no sistema: sem serviços, sem entradas em "Aplicações", é só extrair e correr
- **Fallback** — o instalador falha naquela máquina concreta (antivírus ou políticas da empresa a bloquear serviços), ou queres experimentar a app sem compromisso

Descarrega [`oficinaos-portable.zip`](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip), extrai para uma pasta e corre `INICIAR.bat`. A app é exatamente a mesma — mesmo código, mesma base de dados PostgreSQL, mesmas funcionalidades — e o botão **"Atualizar"** dentro da app também funciona (descarrega só a parte da app com verificação SHA-256, backup e rollback automático).

Duas diferenças práticas face ao Setup.exe:

- O arranque automático é uma **tarefa agendada opcional** (o `INICIAR.bat` pergunta na 1ª execução) em vez de um serviço Windows
- Como ninguém abre a firewall por ti, o Windows pergunta **uma vez** se permite a ligação — escolhe **Permitir** (rede privada) para os tablets da loja ligarem

> Se vieste do erro **"virtualization support not detected"** do caminho Docker (BIOS com VT-x/SVM desligado), o portátil também resolve — mas o Setup.exe é ainda mais simples, porque também não precisa de Docker.

### Uso diário (modo portátil)

Dentro de `oficinaos-portable\`:

| Ficheiro | Para quê |
|---|---|
| `INICIAR.bat` | Ligar tudo (Postgres + app) — duplo clique, abre o browser |
| `PARAR.bat` | Desligar (os dados ficam guardados em `data\`) |
| `ATUALIZAR.bat` | Atualizar para a versão mais recente (preserva dados e configuração) |
| `BACKUP.bat` | Backup manual da base de dados |
| `RESTAURAR.bat` | Repor a base de dados a partir de um backup |

- **Arranque automático**: na primeira execução o `INICIAR.bat` pergunta se queres que o OficinaOS arranque sozinho quando o PC liga (regista uma tarefa agendada; para remover: `schtasks /delete /tn "OficinaOS" /f`)
- **Se a app crashar**: reinicia sozinha passados 5 segundos (wrapper de respawn)
- **Backups**: feitos automaticamente a cada arranque para `app\uploads\backups\` (retenção 14 dias) — o indicador de backups na app funciona igual

### Diferenças vs instalação por Setup.exe

| | Setup.exe | Portátil |
|---|---|---|
| Requer administrador | sim, na instalação | **não** |
| Tamanho do download | ~339 MB | ~540 MB uma vez |
| Arranque com o PC | automático (serviço Windows) | automático se aceitares a tarefa agendada |
| Regra de firewall para a LAN | criada na instalação | o Windows pergunta uma vez — escolher Permitir |
| Backups automáticos | diário às 03:30 (`ProgramData\OficinaOS\backups`) | a cada arranque + `BACKUP.bat` |
| Atualizar | botão "Atualizar" na app, ou Setup por cima | botão "Atualizar" na app, ou `ATUALIZAR.bat` |
| Ícone na bandeja | sim | não |
| Acesso de outros dispositivos na LAN | `http://oficinaos.local:4000` ou IP | igual |

### Restaurar um backup (modo portátil)

1. Duplo clique em **`RESTAURAR.bat`** — lista os backups em `app\uploads\backups\` do mais recente ao mais antigo
2. Escolhe o número do backup e confirma com `SIM` — ⚠️ **substitui todos os dados atuais** pelos do backup
3. O script para a app, recria a base de dados e aplica o dump; no fim corre `INICIAR.bat`

> Backups no mesmo disco não protegem contra avaria, roubo ou ransomware — copia `app\uploads\backups\` para um disco externo ou pen com regularidade.

### Migrar entre instalações

Os dumps são `pg_dump` plain comprimidos — o mesmo formato nos dois modos, portanto migrar é fazer backup num lado e restaurar no outro.

**Portátil → Docker:**
1. No portátil: `BACKUP.bat` → copia o `oficinaos-*.sql.gz` de `app\uploads\backups\`
2. No Docker: coloca o ficheiro no volume de backups (`docker compose cp` ou a pasta mapeada) e corre o restore: `docker compose exec -T db-backup /scripts/run-restore.sh oficinaos-<stamp>.sql.gz`

**Docker → portátil:**
1. No Docker: `docker compose exec -T db-backup /scripts/run-backup.sh` → copia o dump do volume `backups` para `oficinaos-portable\app\uploads\backups\`
2. No portátil: `RESTAURAR.bat` e escolhe esse dump
3. As imagens/ficheiros de upload vivem fora da BD: no Docker está no volume `uploads`, no portátil em `app\uploads\` — copia também esse conteúdo para não perderes fotos e talões

### Desinstalar (modo portátil)

Corre `PARAR.bat` e apaga a pasta `oficinaos-portable`. ⚠️ `data\` contém a base de dados inteira — faz backup primeiro se quiseres guardar. Se ativaste o arranque automático, remove a tarefa: `schtasks /delete /tn "OficinaOS" /f`.

Documentação técnica do bundle: [scripts/portable/README.md](scripts/portable/README.md)

## Atualizar para uma versão nova

**Botão "Atualizar" dentro da app** (instalação por `OficinaOS-Setup.exe` ou modo portátil): quando o aviso de versão nova aparece, o admin tem um botão "Atualizar" — descarrega só o pacote da app (~100 MB em vez de ~600 MB) com verificação SHA-256, faz backup da base de dados antes de mexer, e repõe a versão anterior automaticamente se a nova não arrancar (`/health` falha ou a migração rebenta). A app fica offline ~1-2 minutos durante a troca.

> **Instalações da v1.0.9:** essa versão ainda não trazia o updater — o botão não aparece. É uma passagem manual **uma única vez**: corre o `OficinaOS-Setup.exe` da versão nova por cima (os dados em `ProgramData` ficam) — a partir daí o botão funciona sempre.
>
> Em alternativa, sem reinstalar, numa PowerShell de administrador:
>
> ```powershell
> $base = "https://github.com/braindeadpt/OficinaOS/releases/latest/download"
> Invoke-WebRequest "$base/update-apply.ps1" -OutFile update-apply.ps1
> Invoke-WebRequest "$base/oficinaos-app-update.zip" -OutFile app-update.zip
> # opcional: verifica os .sha256 antes de correr
> powershell -ExecutionPolicy Bypass -File .\update-apply.ps1 -Mode service `
>   -InstallRoot "C:\Program Files\OficinaOS" `
>   -ZipPath .\app-update.zip `
>   -StatusPath "C:\ProgramData\OficinaOS\update-status.json" `
>   -BackupScript "C:\Program Files\OficinaOS\tools\backup.ps1"
> ```

**Docker / à mão:** duplo clique em **`ATUALIZAR.bat`** — faz backup da base de dados, descarrega a imagem nova e reinicia. As migrações da base de dados correm sozinhas no arranque.

À mão, se preferires:

```bat
:: com imagem pré-construída (recomendado):
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d

:: ou, se instalaste em modo build (sem imagem ghcr — o ATUALIZAR.bat trata disto sozinho):
docker compose -f oficinaos-src\app-source\docker-compose.yml up -d --build

:: ou, num checkout git de desenvolvimento:
git pull
docker compose up -d --build
```

### Atualizações automáticas (opcional)

Se quiseres que a app se atualize sozinha, ativa o perfil `auto-update` no `.env`:

```ini
COMPOSE_PROFILES=auto-update
UPDATE_SCHEDULE=0 30 7 * * *   # cron de 6 campos — por defeito 07:30 diário
```

Depois `docker compose -f docker-compose.app.yml up -d` para arrancar o Watchtower. Escolhe uma hora em que **o PC está ligado e a loja fechada** — atualizar implica uns segundos de restart. Só o contentor da app é atualizado; a base de dados e os backups nunca são mexidos. Se uma atualização correr mal, o dump diário (14 dias de retenção) permite restaurar.

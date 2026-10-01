# Instalar o OficinaOS — passo a passo

Guia para Windows. Demora ~10 minutos na primeira vez.

## Requisitos

| Requisito | Detalhe |
|---|---|
| **PC** | Windows 10/11 **64-bit** — o PC que fica ligado na loja |
| **RAM** | 4 GB livres (o Docker usa ~1.5 GB) |
| **Disco** | ~5 GB livres (Docker + app + base de dados) |
| **Permissões** | Administrador, só durante a instalação do Docker |
| **Internet** | Só na **primeira instalação** — depois funciona offline na rede local |
| **Docker** | Instalado automaticamente pelo `INSTALAR.bat` — não precisas de saber o que é |
| **Outros dispositivos** | **Nada** — só um browser |

## Cenários de uso

| Cenário | Como funciona |
|---|---|
| **1. Um só PC** (o mais simples) | Instalas no PC do balcão e usas `http://localhost:4000` nesse mesmo PC |
| **2. PC-servidor + vários dispositivos** | O mesmo PC corre a app; tablets, telemóveis e outros PCs abrem `http://<IP>:4000` no browser — sem instalar nada. ⚠️ A app só funciona enquanto esse PC estiver ligado |
| **3. Máquina dedicada** | Um mini-PC ou NAS com Docker sempre ligado corre a app; todos acedem por browser. Ideal para não depender do PC do balcão |
| **4. Acesso pela internet** | Cloudflare Tunnel grátis — HTTPS automático, sem abrir portas no router, funciona com CGNAT. Guia: **[docs/remote-access.md](docs/remote-access.md)**. Também dá links públicos aos clientes (tracking, orçamentos, QR de garantia) |

## 1. Descarregar

1. Descarrega o instalador: **[oficinaos-install.zip](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-install.zip)** — este link descarrega sempre a versão mais recente
2. Extrai o ZIP para uma pasta, ex.: `C:\OficinaOS`

> Alternativa: na página do GitHub, botão verde **Code → Download ZIP** dá o código completo (mais pesado — usa-o só se o instalador falhar).

## 2. Instalar

1. Dentro da pasta, **duplo clique em `INSTALAR.bat`**
2. Se o Windows Defender SmartScreen avisar: **Mais informações → Executar mesmo assim**
3. O instalador faz tudo sozinho:
   - Instala o **Docker Desktop** se não existir (gratuito, oficial)
   - Gera as passwords e segredos automaticamente
   - **Descarrega a imagem pronta do GitHub** (segundos) — se falhar, constrói localmente (~5 min)
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

## Instalação portátil (sem Docker)

Para PCs onde o Docker não funciona — tipicamente porque a **virtualização de hardware (VT-x/SVM) está desativada na BIOS** ou o processador não a suporta. O `INSTALAR.bat` deteta isto automaticamente e propõe duas opções:

- **Ativar na BIOS** — reiniciar, premir F2/F10/DEL/ESC, procurar "Intel VT-x" / "Virtualization Technology" / "SVM Mode" em Advanced/Security, ativar e gravar (F10). Depois o caminho Docker normal funciona.
- **Instalação portátil** — um pacote que traz tudo embutido (Bun + PostgreSQL), sem Docker, sem admin, sem serviços Windows. Funciona em qualquer Windows 10/11 64-bit.

No caminho portátil o instalador descarrega `oficinaos-portable.zip` (~540 MB), extrai para `oficinaos-portable\` e arranca. A app é exatamente a mesma — mesmo código, mesma base de dados PostgreSQL, mesmas funcionalidades, mesmas migrações automáticas.

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

### Diferenças vs instalação Docker

| | Docker | Portátil |
|---|---|---|
| Funciona sem virtualização/BIOS | não | **sim** |
| Tamanho do download | ~1 GB (Docker + imagem) | ~540 MB uma vez; cada update re-descarrega tudo |
| Arranque com o PC | automático | automático se aceitares a tarefa agendada |
| Backups off-site (rclone) | suportado | não — copia `app\uploads\backups\` para um disco/pen manualmente |
| Update automático (Watchtower) | opcional | não — sempre manual via `ATUALIZAR.bat` |
| Tunnel Cloudflare (acesso remoto) | incluído no compose | instalação manual do cloudflared |
| Acesso de outros dispositivos na LAN | `http://<IP>:4000` | igual |

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

Quando a app avisar que existe versão nova (ou quando quiseres): duplo clique em **`ATUALIZAR.bat`** — faz backup da base de dados, descarrega a imagem nova e reinicia. As migrações da base de dados correm sozinhas no arranque.

À mão, se preferires:

```bat
:: com imagem pré-construída (recomendado):
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d

:: ou, se instalaste a partir do código-fonte:
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

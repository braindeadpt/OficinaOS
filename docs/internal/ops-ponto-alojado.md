# Operação do ponto alojado

Guia para alojar várias empresas standalone do Livro de Ponto num único VPS.
Cada cliente fica isolado num projeto Docker próprio, com base de dados,
volumes, segredos e contentores separados. O Caddy partilhado termina TLS em
`https://<slug>.<domínio-base>` e encaminha apenas para o contentor interno
dessa empresa.

## Pré-requisitos

- VPS Linux com Docker Engine e Docker Compose v2.
- Portas 80/443 livres no VPS.
- DNS `*.<domínio-base>` (ou um registo A por cliente) a apontar para o VPS.
  Se o DNS estiver na Cloudflare, o instalador pode criar/atualizar o registo
  com `CF_API_TOKEN` e `CF_ZONE_ID`.
- Conta Cloud do tipo `ponto_standalone` e um código de emparelhamento válido
  para essa empresa.
- Cópia deste repositório no VPS (o instalador copia os scripts de backup a
  partir de `scripts/`).

## Instalação ou atualização idempotente

Os dados sensíveis passam por variáveis de ambiente, nunca como argumentos na
linha de comandos:

```bash
export PONTO_CLIENT_SLUG="empresa-exemplo"
export PONTO_CLIENT_NAME="Empresa Exemplo, Lda"
export PONTO_OWNER_NAME="Nome do Responsável"
export PONTO_OWNER_LOGIN="responsavel@example.com"
export PONTO_OWNER_PASSWORD='password inicial forte'
export CLOUD_PAIRING_CODE='XXXX-XXXX'  # obrigatório só na primeira instalação/emparelhamento

# Opcionais:
export PONTO_BASE_DOMAIN="ponto.oficinaos.app"
export PONTO_CLOUD_API_URL="https://cloud.oficinaos.app"
export PONTO_HOST_ROOT="/opt/oficinaos-ponto"
export PONTO_TZ="Europe/Lisbon"
# export CF_API_TOKEN='...'
# export CF_ZONE_ID='...'

sudo -E bash scripts/install-ponto-hosted.sh
```

O script:

1. cria `/opt/oficinaos-ponto/clientes/<slug>` com `.env` 0600;
2. gera segredos fortes apenas quando ainda não existem;
3. cria uma rede Docker externa partilhada e um Caddy único;
4. cria/atualiza o bloco HTTPS `<slug>.<domínio-base>` no Caddy;
5. arranca Postgres, app, backup diário e Evolution API isolados no projeto
   `ponto-<slug>`;
6. espera por `/health`;
7. cria o proprietário em `shopMode="ponto_only"` apenas no primeiro arranque;
8. emparelha a instância à Cloud; se já estiver emparelhada, não consome outra
   vez o código.

`CLOUD_PAIRING_CODE` só é consumido se a instância ainda não estiver emparelhada; em reexecuções pode até ser omitido se já houver ligação Cloud.

Voltar a executar o mesmo comando é seguro: os segredos e os dados são
preservados, o bloco Caddy é substituído no lugar, os contentores só são
recriados se a configuração mudar e o bootstrap entra por login em vez de
repetir o primeiro setup.

> Se o responsável mudar a password depois da instalação, uma nova execução
> precisa da password atual em `PONTO_OWNER_PASSWORD`. A password só existe em
> memória/ficheiro temporário durante o bootstrap; não fica no `.env`.

## DNS e TLS

Sem `CF_API_TOKEN`, garantir primeiro o DNS manualmente:

```text
<slug>.<domínio-base>  A  <IP público do VPS>
```

Com Cloudflare, o instalador cria ou atualiza esse registo A como `proxied=false`
para não interferir com a emissão inicial do certificado. O Caddy pede e renova
o certificado automaticamente; a primeira emissão pode demorar alguns minutos.
Enquanto o certificado não existir, o arranque interno já está feito, mas o URL
público pode responder erro TLS.

## Verificação após instalação

```bash
curl -I "https://<slug>.<domínio-base>/health"
cd /opt/oficinaos-ponto/clientes/<slug>
sudo docker compose ps
sudo docker compose logs --tail=100 app
sudo docker compose logs --tail=100 db-backup
```

Verificações funcionais mínimas:

- abrir `https://<slug>.<domínio-base>` e entrar com o responsável;
- o painel inicial é «Agora» do Livro de Ponto;
- o menu não mostra reparações, stock, caixa nem POS;
- Definições → Cloud mostra a instância emparelhada;
- o QR do ponto aparece e o PIN/roster responde através da Cloud;
- o primeiro backup aparece em `/backups` do volume ou no estado de backups da
  aplicação.

## Backups cifrados e restauro

O backup operacional do ponto alojado usa este modelo:

1. `pg_dump -Fc` dentro do contentor `db-backup`;
2. cifragem imediata com age, usando apenas
   a **chave pública** em `BACKUP_AGE_PUBLIC_KEY`;
3. assinatura minisign do ficheiro, para o restauro conseguir distinguir um
   backup produzido pelo servidor de um objeto substituído no bucket;
4. envio do ficheiro `.dump.age` e da assinatura `.minisig` para um destino
   S3-compatível;
5. retenção de 30 dias no destino;
6. alerta em falha num ficheiro de estado e, opcionalmente, num webhook.

A **chave privada age nunca fica no servidor**. Nem em `.env`, nem no compose,
nem em volume Docker. Sem ela, um atacante com acesso ao VPS ou ao bucket não
consegue ler os dados dos funcionários.

O servidor tem, isso sim, uma **chave privada minisign separada** em
`backup-keys/backup-signing.key` dentro do diretório da instância. Ela não
decifra backups: só prova que o ficheiro foi produzido por aquele servidor. A
respetivo par deve ser copiado para a máquina de restauro: a pública
(`backup-signing.pub`) para validar backups no restauro manual e a privada
(`backup-signing.key`, 0600) para assinar o marcador mensal de verificação.
Esta chave privada não decifra dados, mas permite assinar marcadores/backups;
guarda-a no mesmo cofre da chave age privada. Se o servidor for comprometido, o atacante pode assinar backups
novos, mas continua sem conseguir ler backups antigos nem o conteúdo dos dados.

### Gerar a chave (na máquina de operador, não no VPS)

```bash
# Uma vez por parque de backups, ou uma vez por cliente se preferires isolamento total.
age-keygen -o ponto-backup-age-key.txt
chmod 600 ponto-backup-age-key.txt
grep 'public key:' ponto-backup-age-key.txt
```

Guardar `ponto-backup-age-key.txt` num gestor de segredos/cofre fora do VPS. No
instalador exportar apenas a chave pública:

```bash
export BACKUP_AGE_PUBLIC_KEY='age1...'
export BACKUP_S3_ENDPOINT='https://<endpoint-s3>'
export BACKUP_S3_BUCKET='<bucket>'
export BACKUP_S3_ACCESS_KEY_ID='<access-key>'
export BACKUP_S3_SECRET_ACCESS_KEY='<secret-key>'
# Opcionais:
# export BACKUP_S3_PREFIX='ponto/<slug>'  # por omissão: clientes/<slug>
# export BACKUP_S3_REGION='<região>'
# export BACKUP_ALERT_WEBHOOK_URL='https://<webhook>'
```

O instalador copia estes valores para o `.env` 0600 da instância e exige backup
remoto configurado. Não uses `BACKUP_AGE_PRIVATE_KEY` nem `BACKUP_AGE_KEY_FILE`
no servidor.

### Agendamento e estado

O instalador cria um timer systemd por empresa:

```text
oficinaos-ponto-backup-<slug>.timer
oficinaos-ponto-backup-<slug>.service
```

Ver estado e logs:

```bash
sudo systemctl list-timers 'oficinaos-ponto-backup-*'
sudo journalctl -u oficinaos-ponto-backup-<slug>.service -n 100 --no-pager
```

Sem systemd, o instalador usa `/etc/cron.d/oficinaos-ponto-backup-<slug>` ou,
quando existe, o diretório nativo `/etc/periodic/daily` do BusyBox cron; os
logs ficam em `logs/backup.log` dentro do diretório da instância.

Quando o backup falha, o serviço sai com código diferente de zero. O wrapper do
anfitrião escreve `backup-scheduler-alert.txt` no diretório da instância mesmo
se o contentor não arrancar; quando o script dentro do contentor chega a correr,
este escreve também `/backups-status/backup-alert.txt`. Para ler o estado interno
a partir do anfitrião:

```bash
cd /opt/oficinaos-ponto/clientes/<slug>
sudo docker compose exec -T db-backup   sh -c 'cat /backups-status/backup-alert.txt 2>/dev/null || echo sem-alerta'
```

O alerta é removido numa execução bem-sucedida. Se `BACKUP_ALERT_WEBHOOK_URL`
estiver configurado, é também enviado um POST JSON genérico, sem dados pessoais.

Executar manualmente. É idempotente por dia UTC: se já houver um backup
concluído hoje, sai sem duplicar objeto; para forçar uma nova cópia manual,
usa `BACKUP_FORCE=true`:

```bash
cd /opt/oficinaos-ponto/clientes/<slug>
sudo docker compose exec -T db-backup bash /scripts/run-backup.sh
sudo docker compose exec -T -e BACKUP_FORCE=true db-backup bash /scripts/run-backup.sh
```

### Teste mensal automático de restauro

O teste deve correr **noutra máquina** que tenha a chave privada — por exemplo a
máquina de operação ou um pequeno servidor de manutenção. Nunca no VPS de
produção. Essa máquina precisa de `age`, `rclone` e cliente PostgreSQL
(`psql`/`pg_restore`) e `minisign`, além de acesso a um PostgreSQL descartável.

Criar `/etc/oficinaos/ponto-restore-check.env` com permissões 0600:

```bash
BACKUP_AGE_KEY_FILE=/etc/oficinaos/ponto-backup-age-key.txt
BACKUP_SIGN_PUBLIC_KEY_FILE=/etc/oficinaos/ponto-backup-signing.pub
BACKUP_SIGN_SECRET_KEY_FILE=/etc/oficinaos/ponto-backup-signing.key
BACKUP_S3_ENDPOINT=https://<endpoint-s3>
BACKUP_S3_BUCKET=<bucket>
BACKUP_S3_PREFIX=clientes/<slug>
BACKUP_S3_ACCESS_KEY_ID=<access-key>
BACKUP_S3_SECRET_ACCESS_KEY=<secret-key>
# Estas credenciais precisam de leitura e também de escrita só para publicar
# restore-check-status/last-restore-check.txt e a respetiva assinatura .minisig
# (se limitares por prefixo no bucket inteiro, inclui o prefixo do cliente:
# clientes/<slug>/restore-check-status/last-restore-check.txt*).
PGHOST=<postgres-temporario>
PGPORT=5432
PGUSER=<utilizador>
PGPASSWORD=<password>
RESTORE_CHECK_MAX_ENTRY_AGE_DAYS=35
```

O script `scripts/db-restore-check.sh`:

- descarrega o objeto mais recente e a assinatura;
- rejeita o backup se a assinatura estiver em falta ou for inválida;
- decifra para um ficheiro temporário 0600;
- restaura numa base descartável única por execução (`restore_check_<pid>`);
- exige `count(*) > 0` em `time_entries`;
- exige que a última picagem esteja dentro do limite configurado;
- apaga a base temporária e os ficheiros temporários no fim, mesmo em erro.

Exemplo de cron mensal na máquina de restauro:

```cron
11 4 1 * * root sh -c 'set -a; . /etc/oficinaos/ponto-restore-check.env; set +a; /caminho/para/OficinaOS/scripts/db-restore-check.sh >> /var/log/oficinaos-ponto-restore-check.log 2>&1'
```

Também há exemplos de timer systemd em `scripts/ponto-restore-check.service.example`
e `scripts/ponto-restore-check.timer.example`. Ajusta os caminhos, copia-os para
`/etc/systemd/system/ponto-restore-check.service` e `.timer` na máquina de
restauro e ativa só o timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ponto-restore-check.timer
systemctl list-timers ponto-restore-check.timer
```

O importante é ser mensal, automático, fora do servidor de produção e com as
chaves privadas protegidas.

Num VPS de substituição, preserva `backup-signing.key`/`backup-signing.pub` do
cofre antes da primeira execução: sem a chave original o instalador gera um par
novo e tens de atualizar conscientemente o par confiado na máquina de restauro
(pública para validar, privada para assinar o marcador). Nunca
aceites uma chave nova só porque apareceu no bucket — isso removeria a proteção
contra substituição de backups.

Quando o teste mensal passa, publica um marcador remoto assinado
`restore-check-status/last-restore-check.txt`; o backup diário seguinte valida
a assinatura e só então espelha esse marcador para o painel local da instância.

### Restauro manual passo a passo

1. Na máquina de operador, configurar as variáveis S3 e a chave privada como no
   teste mensal.
2. Carregar as variáveis, deixar o helper configurar o remote rclone sem pôr
   credenciais em argumentos e descarregar o backup mais recente:

   ```bash
   mkdir -p restore-tmp
   set -a; . /etc/oficinaos/ponto-restore-check.env; set +a
   . /caminho/para/OficinaOS/scripts/db-backup-remote.sh
   backup_remote_target
   rclone lsf "$BACKUP_REMOTE_TARGET" --include 'oficinaos-*.dump.age' | sort | tail -1
   rclone copyto "$BACKUP_REMOTE_TARGET/<objeto>" restore-tmp/backup.dump.age
   ```

   `BACKUP_REMOTE_TARGET` já inclui `BACKUP_S3_PREFIX`, quando existir.
3. Verificar a assinatura e decifrar localmente:

   ```bash
   set -e
   rclone copyto "$BACKUP_REMOTE_TARGET/<objeto>.minisig" restore-tmp/backup.dump.age.minisig
   minisign -V -m restore-tmp/backup.dump.age \
     -p /etc/oficinaos/ponto-backup-signing.pub \
     -x restore-tmp/backup.dump.age.minisig
   age -d -i /etc/oficinaos/ponto-backup-age-key.txt \
     -o restore-tmp/backup.dump restore-tmp/backup.dump.age
   chmod 600 restore-tmp/backup.dump
   ```

4. Copiar `backup.dump` por um canal seguro para o VPS ou para a máquina onde a
   instância de substituição vai ser restaurada.
5. Na instância de destino, concluir primeiro o arranque base sem fazer login
   nem marcações. Para manter o emparelhamento Cloud restaurado, exportar
   `PONTO_EXISTING_AI_ENCRYPTION_KEY` com a chave hexagonal original antes da
   primeira execução do instalador. Depois parar a app:

   ```bash
   cd /opt/oficinaos-ponto/clientes/<slug>
   sudo docker compose stop app
   sudo docker compose cp backup.dump db-backup:/backups/backup.dump
   sudo docker compose exec -T db-backup      bash /scripts/run-restore.sh backup.dump
   sudo docker compose up -d
   ```

6. Confirmar `/health`, login do responsável, painel «Agora» e exportação de um
   mês. Confirmar também que a Cloud volta a comunicar; se o
   `AI_ENCRYPTION_KEY` original não tiver sido preservado, é preciso refazer o
   emparelhamento.
7. Apagar com segurança todas as cópias decifradas (`backup.dump`) depois da
   validação. O objeto `.dump.age` pode permanecer no bucket.

### O que fazer se o backup falhar

1. Não apagar volumes nem reinstalar a empresa.
2. Ler `backup-alert.txt` e os logs do timer/cron.
3. Verificar conectividade do contentor à base (`pg_isready`), presença de `age`
   e `rclone`, endpoint/bucket/credenciais e validade da chave pública.
4. Correr manualmente `bash /scripts/run-backup.sh` e corrigir a primeira causa
   de erro. O envio remoto é obrigatório: uma falha de upload conta como falha
   do backup.
5. Se o backup local `.dump.age` existir mas o upload falhar, ele continua
   cifrado no volume `backups`; pode ser copiado manualmente para fora depois de
   corrigir o acesso ao destino.

## Atualização da aplicação

```bash
cd /opt/oficinaos-ponto/clientes/<slug>
sudo docker compose pull app
sudo docker compose up -d
sudo docker compose logs --tail=100 app
```

As migrações correm no arranque da app. Confirmar `/health` e uma entrada de
ponto de teste depois da atualização. Voltar a correr o instalador também é uma
forma válida de atualizar a configuração operacional, mas não é necessário para
um simples pull de imagem.

## Evolution API / WhatsApp local

Por defeito o instalador ativa o perfil `wa-local` com uma Evolution API e uma
base de dados exclusivamente desse cliente. Não há partilha de números ou
sessões entre empresas. Para instalações onde o ponto não use WhatsApp local:

```bash
export PONTO_ENABLE_EVOLUTION=false
```

## Remoção de uma empresa

Operação destrutiva — confirmar sempre o slug e exportar backup antes:

```bash
cd /opt/oficinaos-ponto/clientes/<slug>
sudo docker compose down -v
sudo rm -rf "/opt/oficinaos-ponto/clientes/<slug>"
```

Depois remover manualmente o bloco entre `# BEGIN <slug>` e `# END <slug>` no
Caddyfile e recarregar o proxy:

```bash
sudo docker compose -p oficinaos-ponto-proxy \
  -f /opt/oficinaos-ponto/proxy/docker-compose.yml restart caddy
```

## Limites atuais

- O isolamento é por contentores/volumes Docker no mesmo VPS; não é isolamento
  de máquina virtual.
- O backup off-server continua a exigir configuração `BACKUP_REMOTE_ENABLED` /
  `BACKUP_RCLONE_REMOTE` ou o trabalho futuro de backup gerido pela plataforma.
  As variáveis `RCLONE_CONFIG_*` exportadas antes do instalador são copiadas
  para o `.env` da instância e passadas ao contentor `db-backup`.
- O Caddy fica acessível nas portas públicas 80/443; restrições adicionais por
  IP devem ser feitas na firewall do VPS ou na Cloudflare, conforme a política
  comercial decidida.

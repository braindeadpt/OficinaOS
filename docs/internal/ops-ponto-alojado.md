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

## Backups e restauro

Cada empresa tem volume `backups` próprio. O contentor `db-backup` faz um dump
no arranque e depois uma vez por dia, com retenção local de 30 dias. Os scripts
são copiados para cada instância e ficam em:

```text
/opt/oficinaos-ponto/clientes/<slug>/scripts/
```

Restauro manual, com a app parada:

```bash
cd /opt/oficinaos-ponto/clientes/<slug>
sudo docker compose stop app
sudo docker compose exec -T db-backup \
  bash /scripts/run-restore.sh oficinaos-YYYYmmdd-HHMMSS.sql.gz
sudo docker compose up -d
```

Antes de trocar de VPS ou reconstruir uma instância, guardar também o
`AI_ENCRYPTION_KEY` antigo: o token Cloud guardado na base está cifrado com essa
chave. Na instalação de destino exportar `PONTO_EXISTING_AI_ENCRYPTION_KEY`
(hex de 64 caracteres) antes da primeira execução do instalador; sem ela o
restauro abre, mas a ligação Cloud tem de ser refeita com código novo. Testar o restauro numa
instância nova. O teste obrigatório é: instalar cliente temporário, restaurar o
dump, confirmar login/configuração e exportar um mês PDF.

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

# Recuperação de acesso (password esquecida)

Desde a v1.0.22 nenhum utilizador fica trancado fora do OficinaOS. Há três
caminhos, por ordem de preferência:

## 1. Email — quando a loja tem SMTP configurado

«Recuperar password» no login envia um link para o email da conta. O link
abre `/reset-password?token=…` **no origin onde o pedido foi feito**
(localhost, IP da LAN ou `http://<hostname>.local:<port>` quando o
instalador configurou mDNS) — por isso funciona fora do PC do servidor e
sobrevive a mudanças de IP. O token é de uso único e expira ao fim de 1
hora; todas as sessões do utilizador são terminadas após o reset.

Sem SMTP (`SMTP_HOST/PORT/USER/PASS` ausentes no `.env`) o login mostra um
painel honesto em vez de fingir que enviou email, e a API responde
`503 EMAIL_NOT_CONFIGURED`.

## 2. Reposição por um administrador — para funcionários

Definições → Utilizadores → **Repor password** (ícone de chave na linha do
utilizador). O administrador define uma password temporária; após o reset o
modal mostra-a com botão **Copiar**. `mustChangePassword` obriga a trocá-la
no primeiro login e as sessões antigas são terminadas. Auditado como
`PASSWORD_RESET`.

## 3. Recuperação local — para o dono/admin que se trancou

Sem rota HTTP: o acesso físico ao servidor é a prova de autorização.

| Instalação | Como |
|---|---|
| Windows (serviço) | Ícone OficinaOS na bandeja → **«Recuperar acesso…»** → UAC → escolher a conta → a password temporária aparece uma vez com «Copiar» |
| Portable | `RECUPERAR-ACESSO.bat` na pasta portable (pede admin, lista contas, pede o username) |
| Docker/Linux | `docker compose exec app bun run recover-access -- --user <username>` |
| Dev | `bun run recover-access` (lista) / `-- --user <username>` |

O script (`server/scripts/recover-access.ts`):

- sem argumentos lista as contas OWNER (inativas vêm marcadas);
- `--user <username>` gera uma password temporária aleatória de 18
  caracteres sem glifos ambíguos (0/O, 1/l/I), grava o hash, ativa
  `mustChangePassword`, termina as sessões, limpa o bloqueio por
  tentativas falhadas (`failedLoginAttempts`/`lockedUntil` — senão a
  temporária era recusada durante o resto do lockout) e audita
  `PASSWORD_RESET` com `toValue` «Recuperação local (servidor)»;
- imprime a password **uma única vez** no stdout — nunca em ficheiros ou
  logs;
- contas inativas são recusadas; `--reactivate` reativa (auditado em
  `metadata.reactivated`);
- desativado em `DEMO_MODE`, como as restantes ações de gestão.

## Nota sobre backups

O backup diário é um `pg_dump` completo — restaurar traz de volta a
**mesma** password esquecida. Backup protege contra perda de dados, não
contra lockout; é para isso que serve a recuperação local.

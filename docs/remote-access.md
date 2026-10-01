# Usar o OficinaOS fora da loja (acesso remoto)

Guia passo a passo para ligar o acesso pela internet — para a equipa usar
o telemóvel fora da loja e para os **links dos clientes** (tracking,
orçamentos, garantia) funcionarem em qualquer lado.

É **grátis**, demora uns **15 minutos** e só se faz **uma vez**.

## O que vais precisar

| Coisa | O que é | Custo |
|---|---|---|
| **Conta Cloudflare** | O serviço que liga a internet ao PC da loja em segurança | Grátis |
| **Um domínio** | O "nome" da loja na internet, ex.: `minhaloja.pt` — compra-se na Cloudflare, Porkbun, Namecheap… | ~10 €/ano |
| **OficinaOS instalado** | A app já a correr no PC da loja com Docker | — |

> **Como funciona (em linguagem simples):** o PC da loja liga-se à
> Cloudflare e fica "à escuta". Quando alguém abre o endereço da loja na
> internet, a Cloudflare passa o pedido por esse canal até ao PC. **Não
> precisas de abrir portas no router** nem de IP fixo — funciona mesmo
> com as internet móveis dos operadores portugueses (CGNAT).

## Passo 1 — Conta Cloudflare e domínio

1. Vai a [dash.cloudflare.com](https://dash.cloudflare.com) → **Sign up**,
   cria a conta gratuita
2. **Add a domain** → escreve o teu domínio
3. A Cloudflare pede para mudar os "nameservers" no site onde compraste o
   domínio — ela mostra exatamente quais são e onde mudar (passo guiado)
4. Espera que fique verde "Active" (pode demorar alguns minutos a horas)

## Passo 2 — Criar o túnel

1. Entra em [one.dash.cloudflare.com](https://one.dash.cloudflare.com)
   (o painel "Zero Trust" — mesma conta)
2. No menu: **Networks → Tunnels → Add a tunnel** → escolhe **Cloudflared**
3. Dá um nome ao túnel, ex.: `oficina` → **Save**
4. A Cloudflare mostra instruções para vários sistemas — escolhe **Docker**.
   Aparece um comando longo; dele só te interessa o **token**: a string que
   começa por `eyJ` (copia-a, é a "chave" do túnel)
5. Continua para **Public Hostname** e cria o endereço público:
   - **Subdomain:** `oficina` (ou `app`, como preferires)
   - **Domain:** o teu domínio
   - **Service:** Type `HTTP` · URL `app:4000`
   - ⚠️ é mesmo `app:4000` — é o nome interno do contentor Docker, não o IP do PC
6. Guarda. O túnel está criado.

## Passo 3 — Ligar na app

Abre o ficheiro **`.env`** na pasta onde instalaste o OficinaOS (com o
Bloco de Notas ou VS Code) e adiciona/edita estas duas linhas:

```bash
TUNNEL_TOKEN=eyJhIjoixxxxx…        # cola aqui o token do passo 2
EXTRA_TRUSTED_ORIGINS=https://oficina.minhaloja.pt   # o teu endereço público
```

> O `APP_URL` fica como está (`http://192.168…:4000`) — assim a loja
> continua a funcionar **mesmo se a internet falhar**, e o acesso remoto
> fica disponível em cima.

Arranca de novo com o túnel:

- **Se instalaste com o INSTALAR.bat** (a maioria) — no `.env` põe também:

  ```bash
  COMPOSE_PROFILES=tunnel
  ```

  e depois abre o `INICIAR.bat` (ou corre `docker compose -f docker-compose.app.yml up -d`).

- **Se instalaste pelo código-fonte:**

  ```bash
  docker compose --profile tunnel up -d
  ```

**Testar:** abre `https://oficina.minhaloja.pt` no telemóvel — se aparecer
o login, está feito. ✅

## Passo 4 — Ativar os links para clientes

Para que os links que a app envia (tracking, orçamento, pedido de
avaliação, QR de garantia) abram fora da loja:

**Definições → Loja → URL base de tracking** → escreve o endereço público
`https://oficina.minhaloja.pt` → Guardar.

## Perguntas rápidas

**Se a internet da loja falhar, a loja para?**
Não. Dentro da loja toda a gente continua a usar `http://192.168…:4000` —
só o acesso remoto é que fica em pausa até a internet voltar.

**Se o PC da loja desligar?**
O acesso remoto para com ele. Quando o PC ligar, o Docker e o túnel
arrancam sozinhos e tudo volta.

**É seguro?**
Sim: HTTPS encriptado, zero portas abertas no router, e os limites de
tentativas de login continuam a funcionar por visitante. Se quiseres uma
barreira extra, o **Cloudflare Access** (grátis, mesmo painel → Access →
Applications) pode pedir email + código antes do login — lembra-te de
deixar de fora os caminhos públicos (`/tracking*`, `/pre-check*`) para os
clientes não baterem na barreira.

**Alternativa máxima segurança:** se preferires que **toda** a gente use o
endereço HTTPS (incluindo dentro da loja), põe `APP_URL=https://oficina.minhaloja.pt`
em vez do IP — mais seguro (cookies endurecidos), mas a loja passa a
precisar de internet para fazer login. Recomendado só se a net da loja for
muito estável.

**Custa alguma coisa?**
O túnel é grátis. O único custo é o domínio (~10 €/ano).

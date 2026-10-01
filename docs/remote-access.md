# Acesso remoto com Cloudflare Tunnel

Acesso ao OficinaOS a partir de qualquer lugar — telemóvel fora da loja, casa do
dono, links enviados a clientes — **sem abrir portas no router**, sem IP público
e sem VPS. Funciona mesmo com CGNAT (MEO/NOS/Vodafone em modo NAT).

O túnel é **opcional**: a app continua a funcionar 100% na rede local sem
internet. O túnel acrescenta uma porta de entrada HTTPS gerida pela Cloudflare.

```
Internet (telemóvel, cliente)
        │  HTTPS
        ▼
   Cloudflare edge
        │  túnel encriptado (ligação de SAÍDA do PC da loja)
        ▼
  cloudflared (container) → app:4000 → OficinaOS
```

## O que precisas

- Uma conta Cloudflare gratuita
- Um domínio próprio na Cloudflare (~10 €/ano, ex.: `minhaloja.pt`) —
  subdomínio grátis ilimitado, ex.: `oficina.minhaloja.pt`
- O OficinaOS já instalado e a correr com Docker

> Sem domínio próprio: podes testar com `cloudflared tunnel --url`, mas o URL
> muda a cada arranque — serve para experimentar, não para produção.

## Passo 1 — Criar o túnel

1. Entra em [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
   (login com a conta Cloudflare que gere o teu domínio).
2. **Networks → Tunnels → Add a tunnel → Cloudflared**.
3. Dá um nome (ex.: `oficina`) e guarda.
4. No ecrã do conector escolhe **Docker** — a Cloudflare mostra um comando
   `docker run … --token eyJh…`. Copia apenas o **token** (a string longa que
   começa por `eyJ`).
5. Em **Public Hostname** cria o endereço público:
   - Subdomain: `oficina` · Domain: `minhaloja.pt`
   - Service type: **HTTP** · URL: `app:4000`
   - (o `app` resolve dentro da rede Docker — não é o IP do PC)

## Passo 2 — Configurar o `.env`

```bash
TUNNEL_TOKEN=eyJhIjoixxxxx…     # o token do passo anterior
```

E escolhe um dos dois modos:

### Modo A — Acesso duplo (recomendado)

A loja continua a usar `http://<IP>:4000`; o túnel adiciona o acesso remoto.
**A app funciona na loja mesmo se a internet falhar.**

```bash
APP_URL=http://192.168.1.33:4000                        # fica como está
EXTRA_TRUSTED_ORIGINS=https://oficina.minhaloja.pt      # adiciona o túnel
```

### Modo B — HTTPS em todo o lado

Máxima segurança (cookies `Secure`, HSTS), mas **todos os dispositivos usam o
URL público — incluindo dentro da loja — e o login exige internet.**

```bash
APP_URL=https://oficina.minhaloja.pt
```

## Passo 3 — Arrancar

Instalação por imagem (a maioria — `INSTALAR.bat`):

```bash
# no .env:
COMPOSE_PROFILES=tunnel
# ou, combinando com as atualizações automáticas:
COMPOSE_PROFILES=auto-update,tunnel
docker compose -f docker-compose.app.yml up -d
```

Instalação por código-fonte:

```bash
docker compose --profile tunnel up -d
```

Verifica:

```bash
docker compose logs -f cloudflared
# "Registered tunnel connection" ×4 = ligado
```

Abre `https://oficina.minhaloja.pt` no telemóvel — deve aparecer o login.

## Passo 4 — Links para clientes

Para que os links enviados aos clientes (tracking, aprovação de orçamento,
pedido de avaliação, recibo/QR de garantia) funcionem fora da loja:

**Definições → Loja → URL base de tracking** → `https://oficina.minhaloja.pt`

Os QRs e links WhatsApp passam a usar o endereço público.

## Segurança — o que muda e o que não muda

- ✅ HTTPS na borda — tráfego encriptado entre a internet e a Cloudflare
- ✅ Zero portas abertas no router — o túnel é uma ligação de saída
- ✅ Rate limits por visitante funcionam (`TRUST_PROXY` já é `true` em produção
  e honra o `X-Forwarded-For` do túnel)
- ✅ Autenticação, CSRF e isolamento de rotas públicas inalterados
- ⚠️ No Modo A os cookies não levam flag `Secure` (para a LAN HTTP continuar a
  funcionar) — na prática o tráfego remoto vai sempre dentro do TLS do túnel
- ⚠️ Não expõe a app a bots: sem o URL público ninguém a encontra, mas considera
  **Cloudflare Access** (Zero Trust → Access → Applications) para exigir email +
  código antes do login — grátis até 50 utilizadores

### Cloudflare Access (opcional, recomendado para a área de staff)

Se quiseres uma barreira extra à frente do login:

1. Zero Trust → **Access → Applications → Add**
2. Self-hosted → hostname `oficina.minhaloja.pt`
3. Policy: Allow → emails da equipa
4. **Exclui os caminhos públicos** para os clientes não baterem na barreira:
   `/tracking*`, `/pre-check*`, `/api/public/*`, `/api/jobs/lookup*`,
   `/api/receipts/*`

## Perguntas frequentes

**A loja funciona se a internet cair?**
No Modo A, sim — todos na loja continuam em `http://<IP>:4000`. No Modo B não:
tudo depende do túnel.

**E se o PC da loja desligar?**
O acesso remoto para com ele — os dados ficam guardados e tudo volta quando o
PC ligar (com `restart: unless-stopped` o Docker sobe sozinho).

**Custa alguma coisa?**
Cloudflare Tunnel é grátis. O único custo é o domínio (~10 €/ano).

**Vários túneis/lojas?**
Cada loja cria o seu túnel com o seu subdomínio (`loja2.minhaloja.pt`), no seu
próprio `.env`.

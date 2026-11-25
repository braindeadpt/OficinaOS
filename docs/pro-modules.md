# Módulos Pro — OficinaOS Cloud

O OficinaOS funciona **grátis e completo dentro da loja**. Os módulos Pro são
funcionalidades que precisam de "chegar à internet" — e isso passa pelo
**OficinaOS Cloud** (`cloud.oficinaos.app`), o serviço que liga a app da loja
ao mundo exterior sem expor o PC da loja.

```
Loja (app local)                OficinaOS Cloud                 Cliente
──────────────                  ────────────────                ────────
Dados completos  ── emparelha ──► Snapshots/filas redigidos ──►   portal web
                 ◄── respostas ──   / mensagens WhatsApp ◄──      whatsapp
```

- A loja cria conta na Cloud e **emparelha** a app com um token (feito uma vez)
- Cada módulo pago é ativado **do lado do servidor** (entitlement) — sem
  ficheiros de licença
- A app pergunta à Cloud a cada ~2 min se há novidades e envia atualizações
- **Sem Cloud emparelhada = tudo local grátis na mesma**; os módulos Pro
  simplesmente não aparecem

## Separação público / privado

| Repositório | Visibilidade | O que lá mora |
|---|---|---|
| `OficinaOS` (app da loja) | público | Core local completo + **adaptadores** Pro |
| `oficinaos-cloud` | **privado** | Toda a lógica paga — portal, bot, IA, filas |
| `oficinaos-diag` | público | Ferramenta de bancada gratuita |
| `oficinaos-website` | público | Site/docs — zero lógica de produto |

Regra estrutural: **o valor pago vive na Cloud, não na app**. O repo público da
app contém apenas clientes finos (`portal.service.ts`, `whatsapp-bot.service.ts`)
que empurram snapshots redigidos — clonar o repo público não dá nenhum módulo Pro
funcional, porque:

- o processamento (páginas públicas, cérebro do bot, relatórios IA) corre
  todo na Cloud privada
- cada rota Pro na Cloud exige entitlement server-side → `402 MODULE_NOT_ENTITLED`
- a app esconde os pontos de entrada quando o módulo não consta dos
  entitlements — a cache local é só um **hint de UI** com validade de 24h
  (renovada pelo poller de ~2 min); a enforcement real é sempre na Cloud

**Para módulos futuros**: a lógica de negócio (prompts IA, regras de decisão,
agregação) entra em `oficinaos-cloud`; a app recebe só o cliente mínimo para
falar com ela. Nunca código pago compilado na app pública.

## Resumo dos módulos

| Módulo | O que o cliente ganha | Onde se usa |
|---|---|---|
| `portal` | Link público `cloud.oficinaos.app/t/...` com estado da reparação + aceitar/recusar orçamento | Botão "Public link" no detalhe do trabalho |
| `whatsapp-bot` | Pergunta "está pronto?" no WhatsApp da loja e recebe resposta automática; aprova orçamento com SIM/NÃO | Notificações → Setup → WhatsApp |
| `diag-intake` | Recebe diagnósticos do `oficinaos-diag` enviados por clientes | Fila de intake na app |
| `ai-reports` | Relatórios de diagnóstico gerados por IA | Anexado a trabalhos/diag |
| `remarketing` | Recontacto automático de clientes inativos via template WhatsApp aprovado — **requer também `whatsapp-bot`** (o envio usa o canal WhatsApp da loja) | Notificações → Setup → WhatsApp |
| `sms` | SMS pelo Android da loja — ligado **à Cloud** (sms-gate modo servidor, multi-loja, funciona com o PC desligado) **ou na LAN** como fallback | Notificações → Setup → SMS |
| `ai-inbox` ⚠️ *em desenvolvimento — ainda não vendido/ativável em produção* | Caixa de entrada unificada de WhatsApp/SMS + assistente de IA para a equipa (qualquer LLM, chat na app ou MCP) — **contratável sozinho** | Mensagens + Definições → IA |
| `ponto` ⚠️ *em beta — nome e preço por decidir* | Livro de ponto por WhatsApp/SMS: QR fixo impresso, comandos (ENTRADA/PAUSA/VOLTEI/SAIDA/ESTADO), prova de localização no raio da loja, registos guardados 5 anos e folha de informação ao trabalhador imprimível | Definições → Cloud → secção Ponto; folhas `/ponto/qr` e `/ponto/info` |

(Desde 2026-11-23 **todo o SMS é Pro** — inclusive o gateway Android na
LAN, que passou de "core grátis" a transporte Pro/fallback. O grátis
não envia nem recebe mensagem nenhuma.)

## Tabela grátis/Pro — canais de mensagens

> **Decisão do dono (2026-11-23): o grátis não envia NADA.** Toda a
> mensagem — SMS e WhatsApp, todos os transportes e direções — é Pro.
> Na app os cards/botões ficam visíveis mas locked ("Esta opção existe
> apenas no OficinaOS Pro."); opt-out "PARAR" fica 100% manual;
> `POST /api/public/quote-respond` continua grátis por ser a página
> pública de resposta a orçamento, não um canal de mensagens.

| | Grátis | Pro |
|---|---|---|
| **SMS** | nada | `sms`: Android ligado à Cloud (`SmsDevice`/`SmsRoute`) — multi-loja, inbound/outbound com PC desligado, respostas automáticas + IA — ou gateway LAN como fallback |
| **WhatsApp oficial** | nada | `whatsapp-bot`: Meta Cloud API — envio `POST /whatsapp/send` ou direto app→Meta, templates auto-sincronizados, janela de 24 h, IA |
| **WhatsApp Evolution** | nada | `whatsapp-bot`: transporte local (não-oficial, disclaimer) + bot inbound com termo próprio + proteções anti-ban (10/h por número, teto diário, dedupe, atraso 3–8 s) |
| **Caixa de entrada + IA de staff** | nada | `ai-inbox` *(em desenvolvimento)*: caixa unificada WhatsApp/SMS, ferramentas na app, chat IA na app (`/ai/staff-reply`) e MCP na Cloud (`/mcp`) — envio sempre com aprovação humana |
| **Livro de ponto (`ponto`)** | nada | registos de ponto entram pelos canais Pro de receção acima — WhatsApp oficial (mensagens interativas + template), Evolution (texto + localização/foto) e SMS; **exige pelo menos um canal Pro de receção ativo** |

## Portal do cliente (`portal`)

Quando ativo, cada trabalho ganha um botão **"Public link"** na página de
detalhe. Ao clicar:

1. A app publica na Cloud um snapshot **redigido** do trabalho (estado,
   dispositivo, orçamento, prazo, timeline — sem custos internos, notas
   privadas ou telefone do cliente)
2. O link é copiado: `https://cloud.oficinaos.app/t/<código>` — envia-se ao
   cliente por SMS/WhatsApp/papel
3. O cliente abre em casa e vê o estado; se houver orçamento pendente, pode
   **Aceitar/Recusar** — a resposta entra na app em ≤2 min pelo fluxo normal
   de orçamentos (com notificação ao staff)
4. Mudanças de estado na app re-publicam automaticamente; remover o link
   apaga a página da Cloud

Quem tem o link vê a página — tratar como um segredo por trabalho.

## Bot de WhatsApp (`whatsapp-bot`)

O cliente escreve para o número WhatsApp **da loja**; o bot responde com dados
reais da ficha:

| Cliente escreve | Bot responde |
|---|---|
| qualquer texto com trabalho ativo | Estado da reparação + previsão |
| "orçamento" / "preço" | Valor + "responde SIM ou NÃO" |
| "SIM" / "aceito" | Orçamento aprovado na app (mesmo fluxo do balcão) |
| "NÃO" / "recuso" | Orçamento recusado |
| código `REP-...` | Estado desse trabalho |
| "ajuda" / áudio / imagem | Encaminha ao staff + aviso na app |
| número desconhecido | Mensagem padrão com contacto da loja |

Funciona com o **próprio número da loja** (Meta "coexistence" — a app WhatsApp
Business continua a funcionar no telemóvel em paralelo).

### Setup — uma vez por conta OficinaOS (operador)

Feito na Meta App "OficinaOS" (developers.facebook.com):

1. Criar Meta App → use case "Connect with customers through WhatsApp"
2. WhatsApp → API setup → número de teste provisionado
3. Webhook: Callback `https://cloud.oficinaos.app/webhooks/whatsapp`,
   verify token em `WA_VERIFY_TOKEN` (.env da cloud) → **Verify and save**
4. Webhooks → WhatsApp Business Account → subscrever campo **messages**
5. **Subscrever a app à WABA** (obrigatório — sem isto a Meta não entrega):
   `POST /{WABA_ID}/subscribed_apps` com um token válido
6. `WA_APP_SECRET` = App Secret da app → `.env` da cloud → restart
7. **Publicar a app** (Publicar → Live): requer Privacy policy URL —
   servida em `https://cloud.oficinaos.app/privacy`
8. Token permanente: Business Settings → System Users → criar → ligar app +
   WABA → gerar token com `whatsapp_business_messaging` +
   `whatsapp_business_management`

### Setup — por loja

1. Notificações → **Setup** → WhatsApp: `enabled` + API Token +
   Phone Number ID + Business ID → a app faz upload das credenciais para a
   Cloud (`POST /shops/whatsapp-credentials`, validadas contra a Graph API
   antes de serem guardadas cifradas). A partir daí os envios saem pelo
   relay `POST /whatsapp/send` — o token Meta deixa de viver no PC da loja
   (é apagado após o primeiro envio Cloud bem-sucedido)
2. Número de teste Meta: só conversa com números verificados (máx. 5) —
   adicionar em WhatsApp → API setup → "To"
3. Número real da loja (coexistence): requer **business verification** da
   Meta e WhatsApp Business no telemóvel da loja

### Limites conhecidos

- Resposta do bot chega em ~10–15 s (poller rápido de mensagens); o resto
  da sincronização mantém o ciclo de ~2 min
- Notificações proativas ("está pronta") fora da janela de 24h do cliente
  saem como **templates** — a app submete-os automaticamente à Meta e a UI
  mostra o estado (aprovado/em revisão/rejeitado + "Voltar a submeter");
  mensagens de template têm custo Meta por conversa
- Número de teste: máx. 5 destinatários verificados — chega para demos
- "Loja fechada": inbound não consumido há >5 min recebe a resposta de
  fallback da Cloud ("Recebemos a sua mensagem. A loja responde assim que
  abrir."), máx. 1 por número/12 h

## Caixa de entrada + IA de staff (`ai-inbox`)

> **Em desenvolvimento — ainda não está disponível em produção** (a app
> que corre nas lojas ainda não tem a caixa de entrada nem o MCP).
> **Pendente de decisão do dono:** o nome comercial e o preço ainda não
> estão fechados — nos textos visíveis usa-se o marcador
> `{{AI_INBOX_NOME}}` / `{{AI_INBOX_PRECO}}` até lá. No código fica só o
> identificador técnico `ai-inbox`.

Módulo próprio, **contratável sozinho** (não obriga a `whatsapp-bot`
nem `sms`). Duas peças:

- **Caixa de entrada unificada (app):** todas as mensagens de WhatsApp
  (oficial + Evolution) e SMS — incluindo as do bot — em
  `BusinessMessage`, com conversas, filtros, atribuição e resposta
  manual na UI "Mensagens".
- **IA para a equipa:** um único conjunto de ferramentas
  (`staffInboxTools`) corre **na app**, sobre a BD local e com as
  permissões do funcionário. O "cérebro" fica na Cloud (system
  prompt + esquemas + ciclo de ferramentas, entitlement `ai-inbox` →
  402 sem módulo) e é servido por duas portas:
  - **chat na app** — `POST /ai/staff-reply`: a loja escolhe qualquer
    API compatível com OpenAI; a chave da loja fica cifrada na Cloud
    (AES-256-GCM, nunca devolvida) ou usa o modelo incluído com
    medição de uso;
  - **MCP na Cloud** — `cloud.oficinaos.app/mcp` (Streamable HTTP):
    Claude, ChatGPT, Cursor, LM Studio e outros clientes ligam com um
    **token pessoal por utilizador** (a Cloud guarda só o hash).
    As chamadas chegam à app por uma ligação permanente
    (`/ai-inbox/link`, iniciada pela app — sem portas abertas na
    loja).

Envio sempre em dois passos: a IA cria um rascunho e um humano aprova
na app. Precisa de um canal que receba mensagens: a Evolution na LAN
funciona só com este módulo (grava na caixa de entrada, sem resposta
automática), ou `whatsapp-bot`/`sms` para os canais oficiais.

## Livro de ponto (`ponto`)

> **Em beta** — nome comercial e preço por decidir.

Livro de ponto digital para os trabalhadores da loja, sem ecrã nem
tablet obrigatório: um **QR fixo impresso** (autocolante) aponta para a
página pública da Cloud (`/ponto/<slug>`), que emite um código de 4
dígitos; o trabalhador envia `ENTRADA <código>` (ou PAUSA/VOLTEI/SAIDA/
ESTADO) pelo WhatsApp ou SMS do número da loja e partilha a
**localização** — a hora é sempre a do servidor, nunca a do telemóvel.

- **Prova:** entrada na loja exige código válido + localização dentro do
  raio configurável (default 100 m); pausa/saída só pedem localização.
  Externos (trabalhadores ao domicílio) registam sem raio e podem enviar
  foto de prova. SMS só para quem a loja marcar "sem WhatsApp" e fica
  sempre por validar.
- **Avaliação na Cloud:** cada marcação (ENTRADA/PAUSA/VOLTEI/SAIDA)
  recebida pelos canais passa por `POST /ponto/evaluate` (entitlement
  `ponto` → 402) — uma app alterada não consegue registar ponto. O
  comando ESTADO dispensa essa avaliação: responde com um resumo local
  das horas e dos registos por validar (o transporte da mensagem —
  webhook WhatsApp/SMS — continua a chegar via Cloud). O pedido leva o telefone e um indicador
  de foto, nunca a imagem. Correções internas (saída presumida pelo
  lembrete, hora declarada pelo trabalhador) são gravadas só na app,
  sem chamada à Cloud. A Cloud **não guarda** localização, fotos nem
  registos: só `PontoToken` de uso único durante ~24 h para auditoria.
- **Na loja:** `TimeEntry` é append-only (correções são linhas novas),
  retenção de 5 anos (Código do Trabalho, art. 202.º); fotos de prova
  apagadas aos 90 dias. O painel (agora, validar, horas, esquecimentos,
  exportar PDF) está em Ponto no menu; as decisões do gestor são
  reversíveis — a validação mais recente é a efetiva — e leitura e
  exportação continuam disponíveis mesmo sem o módulo ativo.
- **Informação ao trabalhador:** Definições → Cloud → secção Ponto tem o
  texto RGPD editável; `/ponto/info` imprime a folha para assinatura e
  `/ponto/qr` a folha do QR. Ver `docs/privacy-and-data.md`.

Precisa de **pelo menos um canal Pro de receção ativo** (WhatsApp
oficial, Evolution ou SMS) — os comandos chegam por esses transportes.

## Emparelhamento com a Cloud

Feito uma vez por loja: a Cloud emite um pairing token → a loja cola na app
(Definições → OficinaOS Cloud) → a app valida e guarda encriptado. Os módulos
ativos aparecem em Definições → OficinaOS Cloud → lista de módulos.

Ativar módulos a uma loja (lado operador, na cloud):

```
bun run scripts/grant.ts "<nome da loja>" portal
bun run scripts/grant.ts "<nome da loja>" whatsapp-bot
```

## Interfaces para agentes de IA (roadmap)

O portal já é consumível por agentes sem trabalho extra:

- `GET /api/portal/<token>` devolve JSON limpo; o token de 16 chars na URL é
  a credencial — um assistente do cliente com browsing já lê o estado da
  reparação a partir do link
- `POST /api/portal/<token>/reply` aceita `{kind:"quote",decision:"approve"|"reject",quoteId}` —
  rate-limited + honeypot anti-bot
- A página `/t/<token>` declara o JSON via `<link rel="alternate" type="application/json">`
  e `noindex`
- `oficinaos.app/llms.txt` indexa a documentação para LLMs/AI search

**Regra de segurança**: credenciais só por reparação (token no link). Nunca um
endpoint "pesquisar por telefone/email" — vazaria a existência de reparações.

**Possível futuro**: MCP server na Cloud (`mcp.oficinaos.app`) expondo tools
`get_status` / `get_quote` / `respond_quote` com o portal token como
credencial, no entitlement `portal` — distinto do `/mcp` do `ai-inbox`
(secção acima), que é para **staff** com as ferramentas da caixa de entrada.
Construir só se as lojas beta confirmarem
procura — hoje o WhatsApp bot cobre o mesmo caso de uso no canal que os
clientes realmente usam.

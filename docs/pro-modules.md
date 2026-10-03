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

## Resumo dos módulos

| Módulo | O que o cliente ganha | Onde se usa |
|---|---|---|
| `portal` | Link público `cloud.oficinaos.app/t/...` com estado da reparação + aceitar/recusar orçamento | Botão "Public link" no detalhe do trabalho |
| `whatsapp-bot` | Pergunta "está pronto?" no WhatsApp da loja e recebe resposta automática; aprova orçamento com SIM/NÃO | Notificações → Setup → WhatsApp |
| `diag-intake` | Recebe diagnósticos do `oficinaos-diag` enviados por clientes | Fila de intake na app |
| `ai-reports` | Relatórios de diagnóstico gerados por IA | Anexado a trabalhos/diag |

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
   Phone Number ID + Business ID → a app regista o `phoneNumberId` na Cloud
   sozinha
2. Número de teste Meta: só conversa com números verificados (máx. 5) —
   adicionar em WhatsApp → API setup → "To"
3. Número real da loja (coexistence): requer **business verification** da
   Meta e WhatsApp Business no telemóvel da loja

### Limites conhecidos

- Resposta do bot demora até ~2 min (ciclo de polling)
- Notificações proativas ("está pronta") fora da janela de 24h do cliente
  precisam de **templates aprovados** na Meta (e custam cêntimos)
- Número de teste: máx. 5 destinatários verificados — chega para demos

## Emparelhamento com a Cloud

Feito uma vez por loja: a Cloud emite um pairing token → a loja cola na app
(Definições → OficinaOS Cloud) → a app valida e guarda encriptado. Os módulos
ativos aparecem em Definições → OficinaOS Cloud → lista de módulos.

Ativar módulos a uma loja (lado operador, na cloud):

```
bun run scripts/grant.ts "<nome da loja>" portal
bun run scripts/grant.ts "<nome da loja>" whatsapp-bot
```

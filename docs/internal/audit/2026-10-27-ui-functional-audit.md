# Auditoria funcional, UX/UI e visual — OficinaOS

**Data:** 27 de outubro de 2026  
**Commit auditado:** `e5fb5ca` (`main`)  
**Âmbito:** app de loja (SPA + API), tema claro/escuro, desktop e mobile, portal público, permissões e i18n.  
**Método:** exploração real da aplicação em Chromium (Playwright), chamadas diretas à API, inspeção de DOM/estado, capturas de ecrã, leitura de código e verificações mecânicas do projeto.

---

## 1. Resumo executivo

A base está saudável: **typecheck, lint, build, i18n e os 1 672 testes passam**, os fluxos principais de criação de cliente, reparação, orçamento público, venda ao balcão, retoma e tarefa funcionam, e o RBAC/CSRF estão ativos. O produto está visualmente coerente e o modo escuro está bem resolvido.

Foram encontrados, no entanto, **um problema crítico de validação de IDs que bloqueia a atribuição de técnicos em qualquer instalação e quebra a experiência de demonstração**, uma **perda silenciosa de dados nas definições**, e um conjunto de problemas de hierarquia visual, formatação, estados vazios e mobile que prejudicam o uso diário.

| Severidade | Nº | Destaques |
|---|---:|---|
| 🔴 Crítico | 1 | `z.string().cuid()` rejeita IDs de utilizadores (better-auth) e IDs `demo-*`: não é possível atribuir técnicos, abrir clientes demo, criar reparações para clientes demo nem ver a atividade do próprio perfil |
| 🟠 Alto | 2 | Meta mensal apagada com input inválido; telefone aceita texto livre (`"abc"`) e cria reparação |
| 🟡 Médio | 8 | Modelos WhatsApp/SMS inacessíveis; relatórios com números/moeda inconsistentes; hierarquia do detalhe de cliente; devoluções sem saída; sidebar cortada; mobile POS/Definições/Relatórios; lista de utilizadores exposta a técnicos |
| 🔵 Baixo | 5 | Avatar inconsistente; alertas duplicados sem contexto; endereço/QR da Ajuda; affordances e estados vazios; favicon em falta |

**Veredicto:** produto utilizável e bem construído, mas **não deve ser dado como “pronto para loja”** enquanto a atribuição de técnicos estiver quebrada e a meta mensal puder ser apagada sem aviso. Os restantes pontos são maioritariamente polimento de alto impacto.

---

## 2. Ambiente e verificações mecânicas

| Item | Resultado |
|---|---|
| `bun run typecheck` | ✅ 0 erros |
| `bun run check` (ultracite) | ✅ 682 ficheiros, 0 avisos |
| `bun run test` | ✅ **173 ficheiros / 1 672 testes** (com PostgreSQL 17.10 local; 0 skipped) |
| `bun run scan-i18n` | ✅ 0 chaves em falta, 0 mortas |
| `bun run check-primitives` | ✅ dentro dos orçamentos |
| `bun run build` | ✅ `built in 1.64s` — apenas avisos `SOURCEMAP_BROKEN` do plugin Tailwind (não bloqueantes) |
| Base de dados | PostgreSQL 17.10, BD de demonstração (`oficinaos_demo`) |
| Runtime | Bun 1.3.10, Vite 8.3.5, API em `:4000`, SPA em `:5173` |
| Browser | Chromium 1243 (Playwright), viewport 1440×1000 e 390×844 |
| Conta | `demo` / modo de demonstração; conta `TECHNICIAN` criada durante a auditoria |

**Nota:** a primeira execução de `bun run test` sem `DATABASE_URL` salta 10 testes de integração. Com `DATABASE_URL` definido, todos os 1 672 passam. Isto é ambiente, não produto — mas convém documentar no README/CI.

---

## 3. Cobertura realizada

### Fluxos exercitados de ponta a ponta

| Área | O que foi feito | Estado |
|---|---|---|
| Autenticação | Login, sessão, mudança de palavra-passe obrigatória no primeiro acesso de técnico | ✅ |
| Dashboard | Inspeção visual e leitura de KPIs, gráficos, alertas e painel de tarefas | ✅ (visual) |
| Reparações | Lista, filtros, paginação “Carregar mais”, detalhe, mudança de estado, notas, orçamento | ✅ |
| Check-in | Passo 1, passo 2, validação, criação com cliente novo, pré-visualização de etiqueta | ✅ |
| Check-in com cliente existente (demo) | Pesquisa e seleção de `demo-cust-*` | ❌ bloqueado |
| Cliente | Criar, listar, abrir, editar inline (guardar), exportar CSV | ✅ (cliente novo) |
| Cliente demo | Abrir `/customers/demo-cust-001` | ❌ “ID de cliente inválido” |
| Portal público | Pesquisa por código + últimos 4 dígitos, tracking, aprovação de orçamento | ✅ |
| Pré-check público | Submissão, código `PRE-*`, registo criado na base de dados | ✅ |
| POS | Venda completa, carrinho, pagamento, stock, checkout vazio bloqueado | ✅ |
| Inventário | Criar peça, listar, pesquisa, sugestão de reposição, estados | ✅ |
| Retomas | Criar retoma com assinatura, listagem, estados | ✅ |
| Tarefas | Criar tarefa, listar, responsável | ✅ |
| Devoluções | Estado vazio; abertura do wizard a partir de reparação entregue | ✅ (abertura) / ⚠️ submissão não concluída |
| Definições | 6 separadores, guardar loja, criar utilizador, widget, backups | ✅ (com falhas) |
| Relatórios | Receita, KPIs, tabela, exportação CSV | ✅ (formatação falha) |
| Notificações | Alertas, outbox, canais, modelos | ⚠️ (modelos inacessíveis) |
| Permissões | Técnico: mudança de password, bloqueio de Definições, relatórios restritos, API de utilizadores | ✅ / ⚠️ |
| Páginas de gestão | Tickets, Mensagens, Encomendas, Fornecedores, RMAs, Procuro-peça, Preços de mercado, Serviços, Acordos | 🔍 visual |
| Estados especiais | 404, token de assinatura inválido, embed de pré-check | 🔍 visual |
| Tema | Claro, escuro, sistema | ✅ (4 ecrãs) |
| Mobile | Dashboard, Reparações, Detalhe, POS, Clientes, Definições, Relatórios, Tracking | 🔍 visual |

### Limitações da auditoria

- Sem impressora térmica/A4, leitor de código de barras, gateway WhatsApp/SMS, SMTP ou conta InvoiceXpress reais: impressão, envio, faturação e email não foram validados ponta a ponta.
- Sem conta Cloud real: o emparelhamento OficinaOS Cloud foi apenas inspecionado visualmente.
- O wizard de devolução foi aberto, mas a submissão não foi concluída; o endpoint foi validado apenas por leitura de código.
- O setup de primeira instalação (`/setup`) não foi reexecutado (a BD já tinha utilizadores); o bloqueio de setup concorrente está coberto por teste de integração.
- Apenas Chromium; Safari/Firefox e dispositivos físicos não foram testados.
- Não foram feitos testes de carga, acessibilidade com leitor de ecrã real, nem auditoria de dependências.

---

## 4. Achados

### 🔴 C1 — Validação `cuid()` rejeita IDs legítimos e quebra funções centrais

**Severidade:** Crítico  
**Áreas:** Reparações, Clientes, Técnicos, Perfil  
**Ficheiros:** [`shared/schemas/customer.schema.ts:85`](../../shared/schemas/customer.schema.ts#L85), [`shared/schemas/job.schema.ts:35`](../../shared/schemas/job.schema.ts#L35), [`shared/schemas/job.schema.ts:110`](../../shared/schemas/job.schema.ts#L110), [`shared/schemas/auth.schema.ts:82`](../../shared/schemas/auth.schema.ts#L82)

**O que acontece**

Os IDs de cliente, técnico e utilizador são validados com `z.string().cuid()`. Mas:

- os dados de demonstração usam IDs legíveis (`demo-cust-001`, `demo-user-owner`, `demo-tpl-001`);
- o better-auth gera IDs aleatórios de 32 caracteres que **não são cuid** (ex.: `t6J2cU81yf8n3zrJ1syKROSeOmLYKUtL`).

Consequências confirmadas:

| Ação | Resultado |
|---|---|
| `GET /api/customers/demo-cust-001` | **400** `INVALID_CUSTOMER_ID` → ecrã “ID de cliente inválido” |
| `POST /api/jobs` com `customerId: "demo-cust-001"` | **400** `{"customerId":["Formato de ID inválido"]}` → check-in com cliente demo impossível |
| `PATCH /api/jobs/:id` com `technicianId` de qualquer utilizador | **400** `{"technicianId":["Formato de ID inválido"]}` → **não é possível atribuir técnicos**; o dropdown volta ao valor anterior sem mensagem |
| `GET /api/users/:id/activity` | **400** → separador “Atividade” do perfil mostra sempre “Nenhuma atividade recente” |

Evidência visual:

- ![Detalhe de cliente demo com erro](../../audit/shots/flows5/customer-demo.png)
- ![Reparação demo após tentar mudar de técnico](../../audit/shots/flows12/after-tech-change.png)
- ![Perfil — atividade vazia por erro 400](../../audit/shots/flows/activity-error.png)

**Impacto**

- O modo de demonstração — principal montra do produto — não consegue abrir clientes nem fazer o fluxo mais importante (check-in de cliente existente).
- Numa instalação real, **atribuir um técnico a uma reparação falha sempre**. É uma função central do dia-a-dia.
- O separador de atividade do perfil fica permanentemente vazio.

**Causa**

Validação de *forma* de IDs opacos. O servidor já verifica existência e permissões; validar o formato não acrescenta segurança e parte do princípio de que todos os IDs são gerados pelo Prisma com `cuid()`.

**Recomendação**

1. Substituir `z.string().cuid()` por `z.string().min(1).max(64)` (ou remover a validação de formato) em `customerId`, `technicianId`, `userIdParamSchema` e parâmetros equivalentes.
2. Manter a verificação de existência/ownership nos serviços.
3. Alternativa estrutural: configurar o better-auth para gerar cuid e regenerar os IDs de demonstração; mesmo assim, aceitar IDs antigos é necessário para migrações.
4. Testes de regressão obrigatórios:
   - `GET /api/customers/demo-cust-001` → 200;
   - `POST /api/jobs` com cliente demo → 201;
   - `PATCH /api/jobs/:id` com técnico real → 200 e persistência;
   - `GET /api/users/:id/activity` com utilizador better-auth → 200.

---

### 🟠 C2 — Meta mensal de faturação é apagada por input inválido, com toast de sucesso

**Severidade:** Alto (perda de dados)  
**Área:** Definições → Informações da loja  
**Ficheiro:** [`src/components/modules/settings/settings-shop-tab.tsx:241`](../../src/components/modules/settings/settings-shop-tab.tsx#L241)

**O que acontece**

Com a meta em `4500`, introduzir `abc` e guardar:

- o formulário mostra **“Definições da loja guardadas”**;
- o campo fica vazio;
- o valor é persistido como `null` no servidor.

O código converte qualquer valor não finito em `null` e envia na mesma:

```ts
const parsedGoal = Number(goal.replace(",", "."));
monthlyRevenueGoal:
  goal === "" || !Number.isFinite(parsedGoal) ? null : parsedGoal,
```

Evidência: ![Meta apagada após “abc”](../../audit/shots/flows7/goal-after.png)

**Impacto:** perda silenciosa de um indicador de gestão. O utilizador acredita que guardou e o dashboard perde a meta. Valores negativos são rejeitados pelo schema com erro genérico, mas o campo inválido não é assinalado.

**Recomendação**

- Validar localmente com mensagem junto ao campo (`"Introduza um valor numérico ≥ 0"`).
- Não enviar nem limpar o valor quando a conversão falha; manter o último valor válido.
- Mostrar erro específico para negativos e para o máximo permitido.
- Teste: `abc` → erro visível, valor anterior preservado, sem PATCH.

---

### 🟠 C3 — Telefone sem validação: `"abc"` cria cliente e reparação

**Severidade:** Alto (qualidade de dados / comunicações)  
**Áreas:** API de clientes e reparações  
**Ficheiros:** [`shared/schemas/customer.schema.ts:24`](../../shared/schemas/customer.schema.ts#L24), [`shared/schemas/job.schema.ts:39`](../../shared/schemas/job.schema.ts#L39)

**O que acontece**

`POST /api/jobs` com `customerPhone: "abc"` devolve **201** e cria o cliente e a reparação. `POST /api/customers` também aceita qualquer string não vazia (até 32 caracteres). O UI apenas exige que o campo não esteja vazio.

**Impacto**

- Números impossíveis entram na base e ficam associados a reparações.
- WhatsApp/SMS e pesquisa por últimos 4 dígitos deixam de funcionar para esses registos.
- Dívida de limpeza de dados e risco de duplicados (a normalização não consegue comparar lixo).

**Recomendação**

- Validar no schema partilhado com a utilidade de telefone já existente (`shared/utils/phone`), aceitando formatos nacionais e internacionais.
- Aplicar a mesma regra no cliente e no servidor; mensagens junto ao campo.
- Testes: `"abc"`, `"123"`, `"+351 912 345 678"`, `"912345678"`.

---

### 🟡 C4 — Definições → Notificações sem modelos WhatsApp/SMS e sem forma de os criar

**Severidade:** Médio  
**Área:** Definições, Notificações  
**Ficheiros:** [`src/components/modules/settings/settings-notifications-tab.tsx:82`](../../src/components/modules/settings/settings-notifications-tab.tsx#L82), [`prisma/seed-demo.ts:552`](../../prisma/seed-demo.ts#L552)

**O que acontece**

O separador diz “Personalize as suas mensagens WhatsApp e SMS”, mas mostra dois estados vazios com o texto “Sem modelo de notificação. Crie um para começar” — **sem qualquer botão de criação**. A lista só filtra `WHATSAPP` e `SMS`; na BD de demonstração existem 11 modelos, mas **todos com `channel: IN_APP`**, pelo que nunca aparecem. Também não há endpoint/UI para criar modelos.

**Impacto:** funcionalidade de comunicação fica sem ponto de entrada; o texto sugere uma ação que não existe. Numa instalação antiga ou após reset de demo, o separador é um beco sem saída.

**Recomendação**

- Alinhar `seed-demo.ts` com `seed.ts`: criar modelos WhatsApp/SMS (ou mostrar também `IN_APP` numa terceira secção).
- Adicionar “Criar modelo” e um formulário mínimo (nome, canal, corpo), ou remover a promessa do estado vazio.
- Diferenciar empty state “sem modelos deste canal” de “sem modelos”.

---

### 🟡 C5 — Relatórios com números e moeda inconsistentes

**Severidade:** Médio  
**Área:** Relatórios  
**Ficheiro:** [`src/pages/reports/revenue-tab.tsx:82`](../../src/pages/reports/revenue-tab.tsx#L82)

**O que acontece**

Os KPIs e a tabela usam `.toLocaleString()` sem locale nem moeda, enquanto o resto da app usa `formatCurrency`/`formatNumber` ([`src/lib/format.ts`](../../src/lib/format.ts)). Resultado visível:

- `Receita total` = **`1446,3`** (sem `€` e sem duas casas decimais);
- `Saldo pendente` = **`745,6`**;
- o mesmo cartão mostra **`+188.86%`** com ponto decimal;
- a tabela mostra `199,9`, `27,9`, `83.78` sem símbolo;
- o dashboard mostra o mesmo tipo de valor como `1651,20 €` — mesma métrica, apresentação diferente.

Evidência: ![Relatórios — formatação inconsistente](../../audit/shots/pages/desktop-reports.png)

**Impacto:** quebra de confiança nos números, formatação dependente do locale do browser (um browser en-US num UI pt-PT muda os separadores) e violação da convenção já documentada em `format.ts`.

**Recomendação**

- Usar `formatCurrency(value, currency)` e `formatNumber(value, 2)` em todos os KPIs e células; `formatNumber` para percentagens com sufixo `%`.
- Reutilizar o hook `useFormatCurrency` já existente.
- Adicionar teste de snapshot para pt-PT e en-US.

---

### 🟡 C6 — Hierarquia do detalhe de cliente e painéis de workflow no topo

**Severidade:** Médio (UX)  
**Área:** Clientes, Pedidos, Retomas  
**Ficheiros:** [`src/pages/customers/detail.tsx:99`](../../src/pages/customers/detail.tsx#L99), [`src/pages/requests/index.tsx`](../../src/pages/requests/index.tsx), [`src/pages/trade-ins/index.tsx`](../../src/pages/trade-ins/index.tsx)

**O que acontece**

No detalhe de cliente, `BusinessHistory` e `RecordWorkflow` são renderizados **antes** do cartão com nome, telefone e email. O utilizador vê primeiro “Mensagens e histórico comercial”, “Tarefas e estado de acompanhamento”, uma tabela de tarefas e só depois a identidade do cliente. O mesmo painel “Tarefas e estado de acompanhamento” aparece expandido dentro dos cartões de Pedidos e entre as linhas da tabela de Retomas.

Evidência:

- ![Detalhe de cliente — identidade no fundo](../../audit/shots/flows7/fail-customer-edit.png)
- ![Pedidos — painel de workflow antes dos dados](../../audit/shots/pages/desktop-requests.png)

**Impacto:** a informação mais importante (quem é o cliente, o que precisa) fica escondida; a página parece uma ferramenta interna de workflow em vez de uma ficha de cliente. Em listas, quebra o ritmo da tabela e dificulta a leitura.

**Recomendação**

- Mover o cartão de identidade para o topo, seguido de reparações; histórico/tarefas em secções colapsadas no fim.
- Não expandir `RecordWorkflow` por defeito em listas e detalhes.
- Na tabela de retomas/pedidos, mostrar apenas um indicador compacto (“3 tarefas”) com expansão sob procura.

---

### 🟡 C7 — Devoluções: estado vazio sem saída e wizard sem semântica de diálogo

**Severidade:** Médio  
**Áreas:** Devoluções, acessibilidade  
**Ficheiros:** [`src/pages/returns/index.tsx:54`](../../src/pages/returns/index.tsx#L54), [`src/components/modules/returns/create-wizard-modal.tsx:84`](../../src/components/modules/returns/create-wizard-modal.tsx#L84)

**O que acontece**

1. Sem devoluções, a página esconde os filtros e mostra “Ainda não há pedidos de devolução” com um único botão **“Limpar filtros”** — que não faz nada, porque não há filtros. Não há CTA para criar.
2. O wizard “Reclamação do cliente” é um `div` fixo sem `role="dialog"`, `aria-modal`, focus trap ou `useModalEffects` (Escape). Os outros modais da app usam o primitivo `Dialog` e têm essa semântica.
3. `submitAccept` tem `try/finally` mas **não tem `catch`**: uma falha do endpoint não mostra erro nem mantém contexto para o utilizador.

Evidências:

- ![Devoluções — botão “Limpar filtros” inútil](../../audit/shots/pages/desktop-returns.png)
- ![Wizard de devolução aberto](../../audit/shots/flows14/wizard-open.png)

**Recomendação**

- Empty state com “Como criar uma devolução” e link para a reparação entregue, ou botão “Nova devolução” que abre o seletor de reparação.
- Migrar o wizard para `Dialog`/`useModalEffects`; adicionar `role="dialog"`, `aria-modal`, foco inicial e Escape.
- `catch` com toast de erro e mensagem no modal.

---

### 🟡 C8 — Sidebar corta itens de navegação em alturas comuns

**Severidade:** Médio (UX)  
**Ficheiro:** [`src/components/modules/sidebar.tsx:64`](../../src/components/modules/sidebar.tsx#L64)

**O que acontece**

Com 900–1000 px de altura, a navegação mostra “RMAs a fornecedores” cortado a meio; “Clientes”, “Inventário de peças” e “Fornecedores” ficam abaixo da dobra. A `<nav>` tem `overflow-y-auto`, mas não há scrollbar visível nem indicação de continuidade, e o botão “Novo check-in” fixo no fundo faz parecer que a lista termina.

Evidência: ![Sidebar cortada](../../audit/shots/pages/desktop-dashboard.png)

**Impacto:** módulos importantes parecem inexistentes; o utilizador pode não descobrir Clientes/Inventário/Fornecedores.

**Recomendação**

- Agrupar itens (Operação / Catálogo / Gestão) e/ou reduzir o espaçamento vertical.
- Adicionar gradiente/fade no fundo da nav e uma scrollbar fina sempre visível.
- Testar a 768 px e 900 px de altura.

---

### 🟡 C9 — POS mobile: carrinho fora do ecrã e sem feedback persistente

**Severidade:** Médio  
**Área:** POS em mobile  
**Ficheiro:** [`src/pages/pos.tsx`](../../src/pages/pos.tsx)

**O que acontece**

Em 390 px, o carrinho e o botão “Finalizar venda” ficam depois de uma grelha longa de peças. Ao tocar numa peça, não há barra fixa com total/quantidade; o utilizador tem de fazer scroll até ao fim para confirmar que o artigo foi adicionado e concluir a venda. Os cartões com “Sugestão de reposição” ficam mais altos que os vizinhos, criando alinhamentos irregulares.

Evidência: ![POS mobile](../../audit/shots/pages/mobile-pos.png)

**Recomendação**

- Barra inferior fixa com “N artigos · total” e botão “Carrinho/Checkout”, acima da bottom nav.
- Feedback imediato ao adicionar (badge + animação curta).
- Altura uniforme dos cartões ou esconder a sugestão num expandable.

---

### 🟡 C10 — Mobile: separadores de Definições e tabela de Relatórios comprimidos/cortados

**Severidade:** Médio  
**Áreas:** Definições, Relatórios em mobile

**O que acontece**

- Definições: 6 separadores em 5 colunas; “Informações da loja” ocupa duas linhas e encosta a “Notificações”/“Utilizadores”; “Dados” fica sozinho numa segunda linha.
- Relatórios: os separadores são cortados a meio (“Operaçõe…”) e a tabela é cortada à direita sem indicação de scroll horizontal.

Evidências:

- ![Definições mobile](../../audit/shots/pages/mobile-settings.png)
- ![Relatórios mobile](../../audit/shots/pages/mobile-reports.png)

**Recomendação**

- Definições: grelha 3×2 ou lista vertical com ícone + label; evitar labels de duas linhas.
- Relatórios: tabs com scroll horizontal e `scroll-snap`, ou select “Secção”; tabela com wrapper `overflow-x-auto` e sombra/“arraste para ver mais”.

---

### 🟡 C11 — Técnicos recebem lista completa de utilizadores, incluindo email do proprietário

**Severidade:** Médio (privacidade)  
**Ficheiro:** [`server/routes/users.ts:56`](../../server/routes/users.ts#L56)

**O que acontece**

Autenticado como `TECHNICIAN`, `GET /api/users` devolve **200** com a lista de utilizadores e campos como `email`, `role`, `isActive` e datas. A permissão `user:list` é necessária para o dropdown de responsável, mas o payload expõe mais do que o necessário.

**Recomendação**

- Criar um endpoint mínimo para seletores (`GET /api/users/technicians` → `id`, `name`, `username`) ou um DTO reduzido para não-OWNER.
- Restringir `user:list` a OWNER e usar o endpoint mínimo nos formulários.

---

### 🔵 C12 — Avatar do perfil mostra “R”, a sidebar mostra “RA”

**Severidade:** Baixo (consistência visual)  
**Ficheiro:** [`src/pages/profile/index.tsx:54`](../../src/pages/profile/index.tsx#L54)

**O que acontece**

O perfil usa `displayUser.name?.charAt(0)`; a sidebar usa `getInitials(name)` (duas iniciais). Para “Rui Andrade”, o perfil mostra **R** e a sidebar **RA**.

Evidência: ![Perfil — avatar “R”](../../audit/shots/pages/desktop-profile.png)

**Recomendação:** usar `getInitials` também no perfil, com fallback para username.

---

### 🔵 C13 — Alertas duplicados e sem contexto

**Severidade:** Baixo/Médio (ruído operacional)  
**Área:** Notificações

**O que acontece**

A inbox mostra **19 alertas “Stock baixo”** iguais, todos “há 10m”, sem nome da peça, quantidade ou link de ação visível. O cartão apresenta apenas título e tempo; o corpo/mensagem não aparece, embora exista `alert.message` no componente.

Evidência: ![Notificações — 19 alertas iguais](../../audit/shots/pages/desktop-notifications.png)

**Recomendação**

- Agregar alertas do mesmo tipo/peça (“3 peças abaixo do nível de encomenda”) ou deduplicar por `type + entityId` enquanto não lidos.
- Mostrar `message`/peça e um link direto para a peça/POS.

---

### 🔵 C14 — Ajuda mostra endereço loopback e QR com host diferente

**Severidade:** Baixo (ambiente/demo)  
**Área:** Ajuda

**O que acontece**

A página afirma “Está ligado à rede da loja”, mas apresenta `http://127.0.0.1:5173` e, por baixo do QR, `http://localhost:5173`. Num telemóvel, nenhum dos dois é alcançável. Em produção o host será o correto, mas a inconsistência entre texto/QR e a mensagem “rede da loja” confunde.

Evidência: ![Ajuda — 127.0.0.1](../../audit/shots/pages/desktop-help.png)

**Recomendação:** usar o mesmo `origin` no texto e no QR; quando o host for loopback, avisar que o acesso por outros dispositivos exige o IP da rede/`APP_URL`.

---

### 🔵 C15 — Affordances e estados vazios inconsistentes

**Severidade:** Baixo (polish)

- No detalhe de reparação, “Partilhar” e “Imprimir etiqueta” parecem texto simples ao lado de botões com fundo (“Imprimir”, “Acompanhar”).
- “Gerir estados” e o dropdown de estado são duas formas concorrentes de mudar o mesmo estado.
- Tickets/Mensagens mostram “Sem registos.” **antes** do cabeçalho da tabela, o que parece uma tabela quebrada.
- Estados vazios de Relatórios/outros módulos usam alturas e ícones diferentes.

Evidências:

- ![Detalhe de reparação](../../audit/shots/pages/desktop-job-detail2.png)
- ![Tickets vazios](../../audit/shots/pages/desktop-tickets.png)

**Recomendação:** uniformizar botões secundários (contorno/fundo), escolher uma única via de mudança de estado e esconder cabeçalhos de tabela quando não há linhas.

---

### 🔵 C16 — Favicon em falta e avisos de sourcemap no build

**Severidade:** Baixo (polish/CI)

- `GET /favicon.ico` devolve **404** (visível no log do servidor); o separador do browser fica sem ícone.
- `bun run build` termina com sucesso, mas emite `SOURCEMAP_BROKEN` do `@tailwindcss/vite`.

**Recomendação:** adicionar `favicon.ico`/`<link rel="icon">`; desativar sourcemaps de produção ou alinhar o plugin para eliminar o aviso.

---

## 5. O que está bem e não deve ser mexido sem necessidade

- **Segurança de sessão:** CSRF obrigatório em escritas (`X-CSRF-Token`), 401/403 corretos, `mustChangePassword` aplicado no servidor (todas as APIs exceto `/api/auth/*`).
- **RBAC:** técnico é redirecionado de `/settings` para `/`, vê apenas separadores de relatórios permitidos, recebe 403 em `GET /api/settings/shop`.
- **Fluxo público:** tracking por código + últimos 4 dígitos e aprovação de orçamento funcionam; não expõe nome/telefone completos.
- **Check-in:** wizard em 2 passos, validação por passo, mapeamento de erros do servidor para campos e pré-visualização de etiqueta.
- **POS:** venda completa com stock e pagamentos; botão de checkout desativado com carrinho vazio.
- **i18n:** 4 idiomas, `html lang` atualizado, 0 chaves em falta/mortas.
- **Tema escuro:** contraste e hierarquia consistentes em dashboard, POS, jobs e definições.
- **Qualidade:** typecheck/lint/build limpos e 1 672 testes verdes; boa cobertura de serviços e regras de negócio.

---

## 6. Plano de correção sugerido

### P0 — antes de qualquer demonstração/entrega

1. Corrigir a validação de IDs (C1) e cobrir com testes de API/UI.
2. Corrigir a meta mensal (C2) para nunca apagar dados sem confirmação.
3. Validar telefone no servidor e no cliente (C3).

### P1 — próxima iteração

4. Semear modelos WhatsApp/SMS e/ou permitir criar modelos (C4).
5. Formatação única de moeda/números/percentagens nos relatórios (C5).
6. Reordenar detalhe de cliente e recolher painéis de workflow (C6).
7. Empty state e acessibilidade do wizard de devoluções (C7).
8. Sidebar e mobile POS/Definições/Relatórios (C8–C10).
9. Reduzir payload de `/api/users` para técnicos (C11).

### P2 — polish

10. Avatar, alertas, Ajuda, favicon, affordances e estados vazios (C12–C16).

---

## 7. Testes recomendados a acrescentar

| Teste | Objetivo |
|---|---|
| `GET /api/customers/demo-cust-001` → 200 | Impedir regressão do C1 no demo |
| `POST /api/jobs` com cliente demo → 201 | Check-in de cliente existente no demo |
| `PATCH /api/jobs/:id` com técnico better-auth → 200 + leitura | Atribuição de técnicos |
| `GET /api/users/:id/activity` com ID better-auth → 200 | Perfil/atividade |
| Definições: `abc` na meta → erro, valor preservado | C2 |
| `POST /api/customers` com telefone `abc` → 400 | C3 |
| Snapshot de relatórios em pt-PT/en-US | C5 |
| E2E mobile POS: adicionar artigo → total visível sem scroll | C9 |
| A11y do wizard de devolução (`role=dialog`, Escape, foco) | C7 |

---

## 8. Anexos

- Capturas de todas as páginas (desktop, mobile, dark): [`audit/shots/pages`](../../audit/shots/pages)
- Capturas dos fluxos (POS, tracking, retoma, definições, permissões): [`audit/shots/flows`](../../audit/shots/flows), [`flows3`](../../audit/shots/flows3), [`flows5`](../../audit/shots/flows5), [`flows7`](../../audit/shots/flows7), [`flows8`](../../audit/shots/flows8), [`flows10`](../../audit/shots/flows10), [`flows11`](../../audit/shots/flows11), [`flows12`](../../audit/shots/flows12), [`flows14`](../../audit/shots/flows14)
- Logs de verificação: `typecheck`, `lint`, `test`, `build` e `check-primitives` executados localmente; resultados resumidos na secção 2.

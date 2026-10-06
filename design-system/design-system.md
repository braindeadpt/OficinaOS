# OficinaOS · Design system «Parafuso» (proposta v0.1)

> Estado: **proposta**, 6 de outubro de 2026. Nada foi alterado nos repositórios.
> Âmbito: uma marca e um sistema para as quatro superfícies: **site** (oficinaos.app, Astro), **app** (React/Vite, Tailwind 4), **portal do cliente e montra** (Cloud, HTML estático) e **painel da loja** (Cloud, HTML estático).
> Ficheiros nesta pasta: `tokens.css`, `tokens.theme.css`, `tokens.preset.js`, `compat-app-material.css`, `shop-accent.js`, `logos/`, `fonts/`, `boards/`, `contrast-report.md`, `src/` (geradores).

---

## 0. Decisão: três direções e a recomendação

Hoje há quatro estilos e três logótipos: site preto + teal com chave inglesa, app azul `#0040a1` com roda dentada, portal azul com chave inglesa e painel Cloud verde-néon `#33ff66` em monospace. Explorámos três direções, todas com AA verificado em claro e escuro (`contrast-report.md`):

| | A · **Parafuso** (recomendada) | B · **Balcão** | C · **Sinal** |
|---|---|---|---|
| Personalidade | Preciso, sereno, de confiança: um bom técnico que explica tudo sem pressa. | Próximo, prático, bem-disposto: o vizinho que resolve. | Técnico, rápido, direto: a bancada de diagnóstico às 9 da manhã. |
| Símbolo | Cabeça de parafuso vista de cima, que é o «O» de OficinaOS. Ranhura em cruz inclinada −20° (está a ser apertado) | Seta em ciclo (entra avariado, sai reparado) à volta de um ponto quente (o cliente) | Mira de diagnóstico: quatro cantos a focar um ponto (o defeito encontrado) |
| Primário | Azul `#1D4ED8` / `#7DA0FF` | Verde-garrafa `#0B6B57` / `#4FD1B0` e laranja `#C2410C` | Lima `#A6E22E` sobre grafite (texto `#3A5A0A`) |
| Letra | Inter (UI) + Manrope (títulos) | Figtree + Bricolage Grotesque | IBM Plex Sans + Space Grotesk |
| Forma | Raio 8–12, sombras suaves | Raio 12–22, botões em pílula | Raio 4–6, contornos finos |
| Quadro | `boards/board-a.png` | `boards/board-b.png` | `boards/board-c.png` |

**Recomendo a A · Parafuso**, por cinco razões:

1. **Continuidade.** O azul e o Manrope já são o que o lojista vê todos os dias na app e o que o cliente final vê no portal. A migração faz-se com uma camada de compatibilidade (`compat-app-material.css`) sem reescrever 112 ecrãs, e o modo escuro (exigido no PRODUCT.md, hoje 0/10 na auditoria) passa a existir de uma vez.
2. **Confiança B2C.** No portal, o cliente decide se aprova um orçamento de 130 €. O azul é a cor mais segura para «isto é sério e está tratado».
3. **Recua bem atrás da marca da loja.** Nas páginas do cliente final a loja é a protagonista. Um azul neutro convive com qualquer cor de destaque da loja. O laranja/verde da B e o lima da C competem com ela.
4. **Os estados não colidem com a marca.** Na B, o verde da marca é quase o mesmo verde de «Em reparação» e «Pronto», por isso foi preciso empurrar «Pronto» para verde-amarelado. Na C, o lima não pode ser texto em fundo claro (1,4:1), o que obriga a duas cores de marca. Além disso, uma estética escura por natureza não serve num balcão com luz fluorescente, e a auditoria já penalizou isso no painel Cloud.
5. **Densidade.** O Inter tem algarismos tabulares e boa legibilidade a 13 px, o que é essencial para a lista do balcão. O Karla atual é simpático, mas fica fraco em tabelas densas.

Da B guardamos a regra de raios generosos no portal (que é mobile) e o tom de voz próximo. Da C guardamos o JetBrains Mono para códigos e IMEI, e a ideia de que o painel interno de admin pode continuar «técnico» desde que use estes tokens.

---

## 1. Princípios

1. **Uma marca, quatro superfícies.** O mesmo logótipo, os mesmos tokens e os mesmos estados em todo o lado.
2. **A loja é a protagonista** nas páginas do cliente final (portal, montra, recibos, SMS). O OficinaOS aparece só no rodapé.
3. **O balcão primeiro.** A informação mais densa vive na app. Tudo tem de se ler a 60 cm, sob luz forte, com as mãos ocupadas: alvos de 44 px no tátil e linhas de 36 px com rato.
4. **A cor nunca é o único sinal.** Cada estado tem ícone e texto.
5. **Calma.** Sem gradientes nos botões, sem néon e sem animações decorativas. O movimento só serve para explicar o que mudou.
6. **Português de Portugal, tratamento por você** (implícito), sem anglicismos desnecessários.

---

## 2. Marca

### 2.1 Logótipo
- **Símbolo:** quadrado de 32 com raio 8 em `#1D4ED8` (escuro: `#2F5BEA`). Leva um disco branco (r = 10,5) e uma ranhura em cruz com rotação de −20°. Ficheiros: `logos/a-symbol.svg`, `logos/a-symbol-dark.svg` e `logos/a-favicon.svg` (o mesmo ficheiro).
- **Wordmark:** «Oficina» + «OS» em Manrope ExtraBold (800), com tracking −0,6 a 30 px. «OS» vai na cor primária. Está convertido em contornos (não depende da fonte): `logos/a-lockup-light.svg` e `logos/a-lockup-dark.svg`.
- **Grafia:** sempre «OficinaOS» (sem espaço, O e OS maiúsculos). Nunca «Oficina OS», «OFICINAOS» nem «oficinaOS//cloud».
- **Área de proteção:** ¼ da altura do símbolo à volta de todo o lockup.
- **Tamanhos mínimos:** símbolo a 16 px (favicon); lockup com 24 px de altura.
- **Não fazer:** rodar, trocar as cores do «OS», pôr o símbolo sem o quadrado em fundos de cor, usar a ranhura direita (um «+» lê-se como «adicionar» ou «farmácia»), voltar à chave inglesa ou à roda dentada.
- **Favicon:** `favicon.svg` (o símbolo), mais `favicon.ico` 32×32 e `apple-touch-icon.png` 180×180 gerados a partir dele (o portal dá hoje 404 no `favicon.ico`).

### 2.2 Sub-marcas
Não se criam logótipos novos. Usa-se texto ao lado do lockup, em Inter 500 `text-muted`: «OficinaOS **Cloud**», «OficinaOS **Diag**».

---

## 3. Tokens

Fonte de verdade: `src/directions.py` (A). Os ficheiros `tokens.css`, `tokens.theme.css` e `tokens.preset.js` são gerados por `python3 src/gen_tokens.py`. Todas as variáveis têm o prefixo `--oos-`.

### 3.1 Cor

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `color-bg` | `#F5F7FB` | `#0B1120` | Fundo da página |
| `color-surface` | `#FFFFFF` | `#121A2C` | Cartões, tabelas, diálogos, campos |
| `color-surface-2` | `#EEF2F8` | `#1A2438` | Cabeçalhos de tabela, zonas secundárias, *hover* de linha |
| `color-surface-3` | `#E3E8F0` | `#222D44` | Selecionado/pressionado neutro, *skeleton* |
| `color-border` | `#D6DDE8` | `#2A3650` | Divisórias, contorno de cartões |
| `color-border-strong` | `#8792A6` | `#6B7894` | Contorno de campos e botão secundário (≥ 3:1) |
| `color-text` | `#111827` | `#E8EDF6` | Texto principal |
| `color-text-muted` | `#4A5468` | `#A6B1C5` | Texto secundário, labels de tabela |
| `color-text-subtle` | `#5F6878` | `#8E9AB0` | Metadados, rodapés (continua ≥ 4,5:1) |
| `color-primary` | `#1D4ED8` | `#7DA0FF` | Botão primário, links, seleção |
| `color-primary-hover` | `#1A3FB0` | `#9DB7FF` | *Hover*/pressionado do primário |
| `color-on-primary` | `#FFFFFF` | `#0B1120` | Texto sobre o primário |
| `color-primary-soft` | `#E6EDFF` | `#1A2552` | Linha selecionada, fundos informativos |
| `color-on-primary-soft` | `#1A3DAA` | `#B6C8FF` | Texto sobre primary-soft |
| `color-accent` | `#0F766E` | `#2DD4BF` | Só no marketing (site): «grátis», destaques. Nunca em estados |
| `color-focus` | `#1D4ED8` | `#9DB7FF` | Anel de foco |
| `color-success` | `#15803D` | `#4ADE80` | Texto/ícone de sucesso |
| `color-warning` | `#A15C00` | `#FBBF24` | Texto/ícone de aviso |
| `color-danger` | `#C42424` | `#F87171` | Erro, ação destrutiva |
| `color-on-danger` | `#FFFFFF` | `#1A0707` | Texto sobre o botão de perigo |
| `color-info` | `#1D4ED8` | `#7DA0FF` | Informação |
| `color-*-soft` / `on-*-soft` | ver `tokens.css` | | Fundos de alertas *inline* (texto sempre `on-*-soft`) |
| `color-inverse` / `on-inverse` | `#111827` / `#F5F7FB` | `#E8EDF6` / `#0B1120` | *Toasts* |
| `color-overlay` | `rgb(17 24 39/.45)` | `rgb(0 0 0/.6)` | Fundo de diálogos |

Contraste verificado: texto ≥ 4,5:1 em `bg`, `surface` e `surface-2`; bordas de campo, foco e pontos de estado ≥ 3:1. O relatório completo está em `contrast-report.md`.

### 3.2 Estados da reparação (mapa único app + portal + painel)

Substitui `src/lib/status-colors.ts`, mantendo a estrutura `container` + `dot`. O ícone passa a fazer parte do estado.

| Estado (`JobStatus`) | App (PT) | Portal (PT, cliente final) | EN | ES | Ícone Lucide | Chip claro (fundo/texto) | Chip escuro | Ponto claro/escuro |
|---|---|---|---|---|---|---|---|---|
| `INTAKE` | Receção | Recebido na loja | Received | Recibido | `inbox` | `#E6EDF6` / `#2B4669` | `#1B2940` / `#AFC6E6` | `#4F6F96` / `#6F93C2` |
| `WAITING_FOR_PARTS` | A aguardar peças | À espera de peças | Waiting for parts | Esperando piezas | `package` | `#FCEFD2` / `#764400` | `#382808` / `#F6C86A` | `#C27C0E` / `#D99A1E` |
| `IN_REPAIR` | Em reparação | Em reparação | In repair | En reparación | `wrench` | `#E2E9FF` / `#1A3DAA` | `#1A2552` / `#AEC1FF` | `#2F5BEA` / `#6F8FFF` |
| `ON_HOLD` | Em espera | Em pausa | On hold | En espera | `pause` | `#F1E8FB` / `#5A2A8A` | `#2B1B41` / `#D6BBF3` | `#8B5CC7` / `#A57FDB` |
| `DONE` | Pronto | Pronto a levantar | Ready | Listo | `circle-check` | `#DBF3E3` / `#0F5A31` | `#0E3220` / `#86E2AC` | `#1F9D55` / `#34C474` |
| `DELIVERED` | Entregue | Entregue | Delivered | Entregado | `package-check` | `#ECEFF3` / `#3D4654` | `#222934` / `#BAC3D0` | `#7A8494` / `#7D8899` |
| `RETURNED` | Devolvido | Devolvido sem reparação | Returned | Devuelto | `undo-2` | `#FDE3E3` / `#9E1A1A` | `#3C1517` / `#FFB0B0` | `#D93636` / `#F05A5A` |
| `CANCELLED` | Cancelado | Cancelado | Cancelled | Cancelado | `circle-x` | `#F1F2F4` / `#575E6C` | `#1D2129` / `#9BA3B2` | `#868D99` / `#6B7383` |

Notas:
- Proponho mudar «Concluído» para **«Pronto»** (é mais curto no chip e é o que o balcão diz) e «A aguardar por peças» para **«A aguardar peças»**. É uma alteração em `pt.json`.
- «Cancelado» leva o texto riscado só nas listas, nunca no chip do portal.
- Tokens: `--oos-status-{intake|waiting-for-parts|in-repair|on-hold|done|delivered|returned|cancelled}-{bg|fg|dot}`. Em Tailwind: `bg-status-done-bg text-status-done-fg`.

### 3.3 Tipografia

| Papel | Família | Alternativas de sistema |
|---|---|---|
| UI e texto | **Inter** (variável, 400–700, OFL) | `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` |
| Títulos e números-herói | **Manrope** (variável, 700–800, OFL) | Inter, depois sistema |
| Códigos, IMEI, NIF, referências | **JetBrains Mono** (400–600, OFL) | `ui-monospace, Menlo, Consolas, monospace` |

- **Alojamento próprio**, sem Google Fonts (por causa do RGPD e do bloqueio do FCP, achado M-7 da auditoria). Os ficheiros `woff2` (latin + latin-ext) estão em `fonts/`. Usar `font-display: swap` e fazer `preload` só de `inter-latin.woff2`.
- `font-variant-numeric: tabular-nums` em preços, datas, quantidades e colunas numéricas.
- Escala (tamanho/altura de linha):

| Token | px | Uso |
|---|---|---|
| `text-caption` | 11/16, 600–700, maiúsculas, +0,06em | Cabeçalhos de tabela, *eyebrows* |
| `text-xs` | 12/16 | Ajuda dos campos, metadados, chips pequenos |
| `text-sm` | 13/18 | **Lista densa do balcão** |
| `text-base` | 14/20 | Corpo da app |
| `text-md` | 15/22 | Corpo do portal, da montra e do site |
| `text-lg` | 18/26, 600 | Subtítulos, valores em cartões |
| `text-xl` | 22/28, Manrope 700 | Título de secção |
| `text-2xl` | 28/34, Manrope 700 | Título de página |
| `text-3xl` | 36/40, Manrope 800, −0,02em | Número-herói (KPI), títulos do site |
| `text-4xl` | 48/52, Manrope 800 | Hero do site (`clamp(2.25rem, 5vw, 3rem)`) |

- Capitalização: **maiúscula só no início da frase**, em títulos, botões e menus («Nova reparação», não «Nova Reparação»). Maiúsculas totais só em `text-caption`.

### 3.4 Espaçamento, alturas, raio, sombra

- **Espaçamento** em base 4: `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96` px (`--oos-space-*`). Por omissão: 16 px dentro de cartões, 24 px entre secções da app, 64–96 px entre secções do site.
- **Alturas de controlo:** `sm` 32 (só em tabelas com rato), **`md` 40 (desktop)**, **`lg` 48 (tátil, portal)**. Linhas de lista: denso 36, confortável 48. Com `@media (pointer: coarse)`, tudo passa a `lg` e a lista passa a confortável.
- **Raio:** `xs 4` (chips de tabela quadrados, *kbd*), `sm 6` (*tooltips*), **`md 8` (botões e campos)**, **`lg 12` (cartões, tabelas, diálogos)**, `xl 16` (*bottom sheets*, cartões do portal), `pill` (chips de estado, *avatars*).
- **Sombra:** `sm` (cartões em repouso), `md` (*popovers*, menus), `lg` (diálogos, *toasts*). No escuro, a profundidade vem sobretudo da superfície (`surface` → `surface-2` → `surface-3`). As sombras escuras são quase invisíveis de propósito.
- O princípio «camadas tonais, sem linhas» do DESIGN.md mantém-se para os cartões. Nas **tabelas densas usa-se divisória de 1 px `border`**, porque sem ela as linhas de 36 px confundem-se.

### 3.5 Movimento

| Token | Valor | Uso |
|---|---|---|
| `duration-instant` | 80 ms | *Hover*, pressionado |
| `duration-fast` | 120 ms | Chips, *switches*, *tooltips* |
| `duration-base` | 180 ms | *Popovers*, menus, *toasts* a entrar |
| `duration-slow` | 280 ms | Diálogos, *bottom sheets* |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | Por omissão |
| `ease-enter` | `cubic-bezier(.16,1,.3,1)` | Entradas (subida suave de 8 px + *fade*) |
| `ease-exit` | `cubic-bezier(.4,0,1,1)` | Saídas (mais rápidas que as entradas, cerca de 70 %) |

Sem *bounce* nem *spring*. Com `prefers-reduced-motion: reduce`, as durações vão a 0 (já está em `tokens.css`) e o *skeleton* deixa de pulsar.

---

## 4. Componentes e estados

Estados comuns a todos os controlos: **repouso · *hover* · foco visível · pressionado · desativado · a carregar · erro**.
- **Foco:** `box-shadow: var(--oos-focus-ring)` (2 px na cor da superfície + 2 px `focus`), só em `:focus-visible`. Nunca usar `outline: none` sem substituto.
- **Desativado:** opacidade 0,5, `cursor: not-allowed` e sem *hover*. Se o motivo não for óbvio, explicá-lo em texto (*tooltip* ou ajuda), por exemplo «Registe o pagamento para poder entregar».

### 4.1 Botões

| Variante | Repouso | *Hover*/pressionado | Uso |
|---|---|---|---|
| **Primário** | `bg primary`, texto `on-primary`, `shadow-sm` | `primary-hover` | Uma por ecrã/diálogo: «Nova reparação», «Guardar», «Receber e entregar» |
| **Secundário** | `bg surface`, borda 1 px `border-strong`, texto `text` | `bg surface-2` | Ações alternativas: «Imprimir», «Voltar» |
| **Fantasma** | transparente, texto `link` | `bg primary-soft` | Ações terciárias e de cancelar dentro de barras |
| **Perigo** | `bg danger`, texto `on-danger` | 8 % mais escuro | Só dentro do diálogo de confirmação («Eliminar cliente») |
| **Perigo suave** | transparente, texto `danger` | `bg danger-soft` | Para a primeira ação destrutiva numa lista, que abre a confirmação |

- Tamanhos: `sm` 32 / `md` 40 / `lg` 48. O texto é `text-base` 600 (14) em `md` e `text-md` em `lg`. *Padding* horizontal: 12/14/18 px. Ícone de 16 px com 6 px de intervalo.
- Raio `md` (8). **Sem gradiente** (o `button-primary-gradient` e o `.atelier-gradient` saem).
- **A carregar:** o *spinner* de 16 px substitui o ícone, o texto passa ao gerúndio PT-PT («A guardar…»), a largura fica fixa e o botão fica `aria-busy="true"`.
- **Botão só com ícone:** mínimo 40×40 (44×44 no tátil), com `aria-label` obrigatório e *tooltip*.
- **Ordem nos diálogos:** secundário à esquerda, primário à direita. No mobile ficam empilhados, com o primário em cima e a toda a largura.

### 4.2 Campos (input, textarea)

- A label fica sempre visível, por cima: `text-base` 600, associada com `for`/`id`. **Nunca usar só *placeholder*.**
- Caixa: altura `md` 40 (`lg` 48 no tátil e no portal), `bg surface`, borda 1 px `border-strong`, raio `md`, *padding* de 12 px, texto `text-base`.
- **Foco:** borda `focus` + anel `0 0 0 3px` de `focus` a 28 %.
- **Erro:** borda de 2 px `danger`, mensagem por baixo em `text-xs` `danger` com o ícone `circle-alert`, `aria-invalid="true"` e `aria-describedby` a apontar para a mensagem. A mensagem diz **o que fazer**: «O IMEI tem 15 dígitos. Faltam 4.», não «Campo inválido». O erro do servidor fica no campo certo e o assistente não volta ao passo 1 (achado 7 da auditoria).
- Ajuda: `text-xs` `text-muted`, por baixo.
- Prefixo e sufixo dentro da caixa, com divisória `border`: `+351`, `€`, `%`.
- Tipos certos: telefone com `inputmode="tel"` (normaliza sem e com +351), IMEI com `inputmode="numeric"` em mono e contador de dígitos, NIF com `inputmode="numeric"` e validação do dígito de controlo, preços com `inputmode="decimal"` (aceita vírgula).
- Obrigatório: «(obrigatório)» em `text-muted` depois da label só quando a maioria dos campos é opcional; caso contrário, marcar «(opcional)». Nunca o asterisco sozinho. A validação é nossa (`noValidate`), sem a bolha nativa em inglês («Please fill out this field»).

### 4.3 Select, combobox e pesquisa

- **Select nativo** em listas curtas (≤ 7 opções), com o mesmo aspeto dos campos e a seta `chevron-down` de 16 px.
- **Combobox** (cliente, marca, modelo): pesquisa à medida que se escreve, navegação com ↑/↓/Enter/Esc e a correspondência destacada a 600. Quando não há resultados, mostra a ação «Criar "iPhone 15 Pro"».
- **Pesquisa global** (Ctrl+K): campo com `search`, atalho visível em `kbd`, e resultados agrupados (Reparações, Clientes, Peças) com o código em mono.

### 4.4 Chips

- **Chip de estado:** pílula, altura 26 (22 na versão pequena das tabelas), ícone de 13 px + texto `text-xs` 600, fundo e texto do mapa §3.2. Não é clicável.
- **Chip de estado acionável** (mudar o estado no detalhe da reparação): o mesmo chip + `chevron-down`, abre um menu com os estados seguintes possíveis e mostra o «próximo passo» em primeiro lugar.
- **Chip de filtro:** contorno `border`, texto `text-muted`. Quando ativo, fica `bg primary-soft` com texto `on-primary-soft` e o ícone `check`. Alvo de 32 px no desktop e 44 px no tátil.
- **Ponto de estado** (8 px, `dot`): só onde não cabe o chip (calendário, *kanban* comprimido), sempre com o texto ao lado ou num *tooltip*.

### 4.5 Tabelas e listas · modo denso (balcão)

- Contentor `surface`, borda `border`, raio `lg`. Cabeçalho `surface-2` em `text-caption` `text-muted`, fixo (*sticky*) quando a tabela faz *scroll*.
- **Denso (por omissão no desktop):** linhas de 36 px, `text-sm` (13/18), *padding* de 10–12 px, divisória de 1 px `border`. **Confortável (tátil):** 48 px, `text-base`.
- Colunas da lista de reparações: **Código** (mono, `link`) · **Equipamento** (modelo a 600 · avaria) · **Cliente** · **Estado** (chip pequeno) · **Há** (idade: «2 d», «5 h») · **Prazo** (a vermelho `danger` se já passou) · **Valor** (alinhado à direita, tabular).
- Texto que não cabe fica cortado com reticências e `title`. O código e o valor nunca são cortados.
- *Hover* `surface-2`; selecionada `primary-soft`; foco de teclado com anel interior. Toda a linha é clicável e leva a um `<a>` real, para que funcione Ctrl+clique.
- Ações por linha: menu `ellipsis` à direita, que aparece no *hover* e está sempre visível no tátil.
- Objetivo: ≥ 14 linhas visíveis num ecrã de 1366×768 (hoje são cerca de 9).
- Abaixo de 640 px, a tabela passa a **lista de cartões** com 2 linhas: código + chip / modelo · cliente · valor.

### 4.6 Cartões e KPI

- `surface`, raio `lg`, `shadow-sm` (ou borda `border` no escuro), *padding* de 16–20 px.
- Padrão «label pequena / valor grande»: label `text-xs` 600 `text-muted`, valor `text-3xl` Manrope 800, contexto `text-sm` `text-muted` com ponto semântico, e link «Ver lista ›».

### 4.7 Diálogos e *bottom sheets*

- Usar o `<dialog>` nativo com `showModal()`, que dá Esc, *focus trap* e `inert`. O foco volta ao elemento que abriu o diálogo.
- `surface`, raio `lg` (`xl` nos *sheets*), `shadow-lg`, fundo `overlay`. Largura: 400 (confirmação), 560 (formulário) e 720 (detalhe). No mobile (< 640 px) passa a *bottom sheet* a toda a largura.
- Estrutura: título `text-xl` · texto `text-base` `text-muted` · conteúdo · ações (secundário · primário).
- **Confirmação destrutiva ou irreversível:** o título é uma pergunta concreta («Entregar R-1042 à Ana Silva?») e o texto diz a consequência e o valor em falta. O botão diz o verbo («Receber e entregar», «Eliminar cliente»), nunca «OK» ou «Sim». Para eliminar dados com histórico, pede-se que o utilizador escreva o código.
- Entrar com *fade* + subida de 8 px em `duration-slow` / `ease-enter`.

### 4.8 *Toasts*

- Fundo `inverse`, texto `on-inverse`, raio `md`, `shadow-lg`, ícone semântico (o sucesso usa `status-done-dot`). Ficam em baixo à direita no desktop e em baixo ao centro no mobile, por cima da barra de navegação.
- `role="status"` e `aria-live="polite"` (para erros, `role="alert"`). Duram 5 s, ou 8 s com ação. Param quando o rato está por cima. Máximo de 3 empilhados.
- Ação opcional à direita, sublinhada: «Desfazer», «Ver». Depois de qualquer ação reversível (mudar estado, arquivar), usar *toast* com «Desfazer» em vez de pedir confirmação.
- Os erros que bloqueiam o trabalho não vão para *toast*: vão para alerta *inline* junto ao sítio do problema.

### 4.9 Alertas *inline* (banner)

`*-soft` + texto `on-*-soft` + ícone + ação. Variantes: info, sucesso, aviso e erro. Exemplo: «Este cliente não autorizou mensagens por WhatsApp. Peça a autorização ou use SMS.»

### 4.10 Estados vazio, a carregar e erro

| Estado | Padrão | Exemplo (app) |
|---|---|---|
| **Vazio (primeira vez)** | Ícone Lucide de 24 px `text-subtle` · título `text-lg` · uma frase · ação primária | «Ainda não há reparações. / Registe a primeira entrada e o cliente recebe o link de acompanhamento por SMS. / [Nova reparação]» |
| **Vazio (filtro)** | Mesmo padrão, com a ação «Limpar filtros» | «Nenhuma reparação "A aguardar peças". [Limpar filtros]» |
| **A carregar** | *Skeleton* com a forma do conteúdo (`surface-3`, raio `xs`), sem *spinner* de página. Se a espera passar de 10 s, mostra «Está a demorar mais do que o normal…» | |
| **Erro de carregamento** | Ícone `cloud-off`/`circle-alert` `danger` · o que aconteceu, em linguagem simples · [Tentar outra vez] · detalhe técnico recolhido | «Não conseguimos carregar as reparações. Verifique a ligação à rede da loja. [Tentar outra vez]» |
| **Limite de pedidos (429)** | Banner de aviso com contagem decrescente | «Muitos pedidos seguidos. Pode continuar daqui a 30 s.» |
| **Sem permissão** | Ícone `lock` + quem pode dar acesso | «Só o administrador pode ver os relatórios.» |
| **Portal 404 / 429 / rede** | Três mensagens distintas (achado M-1) | «Este link expirou ou foi removido. Peça um novo à loja.» / «Muitas visitas seguidas. Tente daqui a uns minutos.» / «Não conseguimos carregar. [Tentar outra vez]» |

Nunca mostrar JSON cru, *stack traces* nem «Error 500».

### 4.11 Componentes do portal e da montra

- **Cabeçalho da loja:** logótipo da loja (ou as iniciais sobre `shop-accent`), nome em Manrope 700 e morada `text-xs`.
- **Stepper:** 4 segmentos de 4 px (Recebido · Em reparação · Pronto · Entregue). Os concluídos levam o `dot` do estado atual e os futuros levam `border`. Por baixo, o estado em texto e a frase do próximo passo («Pode levantar hoje até às 19:00»).
- **Linha do tempo:** ponto + estado + data relativa («hoje, 10:12»; «ontem, 15:40»; «2 out., 11:05»).
- **Saldo:** caixa `surface-2` com «Por pagar» e o valor tabular a 700.
- **Barra de contacto:** Ligar (botão `shop-accent`) · WhatsApp (secundário) · Direções. Em mobile fica fixa no fundo, com 48 px e `safe-area-inset-bottom`.
- **Aprovação de orçamento:** *bottom sheet* com o valor, o que inclui, a garantia e os botões «Aprovar orçamento» (primário) e «Recusar» (secundário). Mostra também «Prefere falar com a loja? Ligar».

---

## 5. Modo escuro

1. **Ativação:** segue o sistema (`prefers-color-scheme`). O utilizador pode forçá-lo em Perfil → Aparência (Automático · Claro · Escuro), com `data-theme` no `<html>` guardado em `localStorage`. Há um script *inline* no `<head>` para evitar o «flash».
2. **Não se inverte nada à mão:** todos os componentes usam tokens semânticos. Proibido usar hex em componentes, proibido `dark:` com cores literais e proibidos `bg-white`/`text-black`.
3. **Elevação por luminosidade:** `bg` < `surface` < `surface-2` < `surface-3`. Um diálogo sobre um cartão fica um nível acima.
4. **Primário mais claro e menos saturado** (`#7DA0FF`), com texto escuro (`on-primary` `#0B1120`) dentro do botão. O mesmo vale para o perigo (`#F87171` com texto `#1A0707`).
5. **Sem branco puro no texto** (`#E8EDF6`) **nem preto puro no fundo** (`#0B1120`), para reduzir o halo em ecrãs OLED e LCD baratos.
6. **Imagens e logótipos:** o logótipo da loja vai sobre uma placa `surface` com 8 px de margem, se for escuro. As fotografias levam `brightness(.92)`. Os gráficos usam as mesmas famílias dos estados, nas variantes escuras.
7. **Impressão (recibos, etiquetas) é sempre clara**, com `@media print` a forçar os tokens claros.
8. **A montra e o portal** seguem o sistema do cliente, mas a loja pode fixar «sempre claro».

---

## 6. Marca da loja nas páginas do cliente final

Aplica-se ao portal `/t/:token`, à montra `/loja/:slug`, aos recibos e etiquetas, ao pré-check-in e aos SMS/WhatsApp.

1. **Primeiro a loja:** o cabeçalho tem o logótipo, o nome e a cor da loja. O título da página e o OG são «Reparação R-1042 · TelePronto Porto». O logótipo OficinaOS **não aparece no topo**.
2. **Rodapé discreto:** «Montra criada com OficinaOS» (no portal: «Acompanhamento com OficinaOS»), em `text-xs` `text-subtle`, com link para `https://oficinaos.app/?utm_source=portal&utm_medium=footer&utm_campaign=<slug>` e, ao lado, «· Privacidade». No máximo 1 linha, sem símbolo e sem cor.
3. **Cor de destaque da loja (`shop-accent`)** com contraste automático, calculado no servidor com `shop-accent.js`:
   - `--oos-shop-accent`: fundo dos botões principais da loja (Ligar, Reservar, Aprovar orçamento), do *stepper* ativo e das iniciais;
   - `--oos-shop-on-accent`: branco ou `#111827`, o que tiver mais contraste (≥ 4,5:1). Se nenhum chegar, o fundo escurece até chegar;
   - `--oos-shop-accent-text`: a cor da loja escurecida (claro) ou clareada (escuro) até ≥ 4,5:1, para links e texto. **A cor crua nunca é usada como texto**;
   - `--oos-shop-accent-border`: se a cor tiver < 3:1 com a superfície (branco, amarelo-claro), o botão leva contorno `border-strong`.
   - Sem cor definida, usa o primário OficinaOS.
4. **O que a loja não muda:** as cores dos estados (são informação, não decoração), as cores de erro e aviso, a tipografia, os raios e o layout. Assim um «Pronto» é sempre verde, em qualquer loja.
5. **Logótipo da loja:** SVG ou PNG de até 512 px, mostrado com 32 px de altura no cabeçalho (40 px na montra), com `alt` = nome da loja desde o HTML do servidor (não depois do JS, achado B-9). Sem logótipo, mostram-se as iniciais (2 letras) sobre `shop-accent`.
6. **Textos da loja, nunca do OficinaOS:** telefone, morada, horário, garantia («Garantia: 30 dias», vinda das definições) e prazos. Nenhuma promessa fixa no código (achado 3: «12 meses», «24 horas», «+351 210 000 000»).
7. **SMS e WhatsApp** assinam com o nome da loja: «TelePronto Porto: o seu iPhone 13 está pronto a levantar. Acompanhe aqui: …». Sem «OficinaOS».

---

## 7. Iconografia

- **Um só conjunto: Lucide** (ISC, `lucide-react` na app; SVG *inline* ou `lucide-static` no site e na Cloud). Substitui gradualmente o Material Symbols (112 ficheiros na app), que é uma fonte de ícones de 300 KB+, e os emojis/SVG avulsos do site.
- Tamanhos: 16 (dentro de botões, chips de 13–14), 20 (navegação, campos) e 24 (vazio, cabeçalhos). *Stroke* de 2 (1,75 a 24 px). A cor herda `currentColor`.
- Os ícones decorativos levam `aria-hidden="true"`. Os ícones sozinhos num botão precisam de `aria-label`.
- Equivalências mais usadas (Material → Lucide): `build`→`wrench`, `inventory_2`→`package`, `person`→`user`, `group`→`users`, `point_of_sale`→`receipt-euro` (ou `banknote`), `settings`→`settings`, `search`→`search`, `add`→`plus`, `print`→`printer`, `smartphone`→`smartphone`, `notifications`→`bell`, `bar_chart`→`chart-column`, `chat`→`message-circle`, `check_circle`→`circle-check`, `error`→`circle-alert`, `delete`→`trash-2`, `edit`→`pencil`, `qr_code`→`qr-code`, `local_shipping`→`truck`, `schedule`→`clock`, `photo_camera`→`camera`.
- Os ícones dos estados estão fixos em §3.2. Não se reutilizam com outro significado (por exemplo, `wrench` não serve para «Definições»).
- O símbolo da marca não é um ícone e não entra na navegação.

---

## 8. Voz e tom (PT-PT)

### 8.1 Regras
1. **Tratamento por você, implícito:** 3.ª pessoa, sem escrever «você». «Guarde as alterações», «A sua reparação está pronta», «A loja entra em contacto consigo». **Nunca «tu»** («Abre a app», «a tua reparação») **nem «vós»** («os dados são vossos»).
2. **Português europeu e Acordo Ortográfico de 1990:** receção, ação, ótimo, direção, atual, fatura. Fora: «Recepção», «Acções», «Percepções».
3. **Frases curtas, voz ativa e verbo primeiro nos botões:** «Imprimir recibo», não «Impressão do recibo».
4. **Dizer o que aconteceu e o que fazer a seguir.** Sem culpar o utilizador e sem «Ups!».
5. **Calmo e caloroso, sem exclamações em série.** No máximo um «!» por ecrã, e só em sucesso real («Tudo pronto!»).
6. **Números e formatos pt-PT:** `129,90 €` (espaço inseparável antes do €, via `Intl.NumberFormat('pt-PT', {style:'currency', currency:'EUR'})`), `6 out. 2026` ou `06/10/2026`, horas `19:00`, telefone `+351 912 345 678`, NIF `123 456 789`.
7. **Género neutro quando possível:** «A loja entra em contacto consigo» em vez de «Será contactado(a)».
8. **EN e ES:** traduzir o sentido, não a palavra. O espanhol ocupa até 25 % mais, por isso nunca se fixa a largura dos botões.

### 8.2 Brasileirismos: não usar

| Não | Sim |
|---|---|
| tela | ecrã |
| celular | telemóvel |
| usuário | utilizador |
| cadastro, cadastrar | registo, registar |
| registrar | registar |
| arquivo | ficheiro |
| salvar | guardar |
| excluir, deletar | eliminar, apagar |
| baixar | descarregar |
| equipe | equipa |
| gerenciar, gerencie | gerir, faça a gestão |
| contato | contacto |
| fato (= facto) | facto |
| senha | palavra-passe |
| aplicativo | aplicação, app |
| planilha | folha de cálculo |
| checar | verificar |
| conserto, consertar | reparação, reparar |
| time (= equipa) | equipa |
| ônibus, trem (exemplos) | autocarro, comboio |
| estou fazendo, cobrindo, utilizando (gerúndio de progressão) | estou a fazer, a cobrir, a utilizar |
| mouse | rato |
| na hora | no momento, de imediato |

### 8.3 Anglicismos: evitar na interface

| Não | Sim |
|---|---|
| check-in, «Novo check-in» | Receção, «Nova reparação» / «Registar entrada» |
| POS, «POS de balcão» | Caixa |
| dashboard | Início, painel |
| login / logout | Iniciar sessão / Terminar sessão |
| password | Palavra-passe |
| upload / download | Carregar / Descarregar (ou «Exportar») |
| status | Estado |
| ticket, job | Ficha, reparação |
| settings | Definições |
| template | Modelo |
| storefront | Montra |
| booking | Reserva |
| refresh | Atualizar |
| backup | Cópia de segurança |
| feedback | Opinião, comentários |
| pairing code | Código de emparelhamento |
| self-hosted, MIT, GitHub (no marketing ao lojista) | «Os dados ficam no computador da loja», «Grátis para sempre» (o técnico fica para «Para técnicos») |
| «chão de fábrica» | balcão, oficina |
| «Média preço» | Preço médio |

Pode ficar: WhatsApp, SMS, IMEI, email, app, MB WAY, Multibanco, IVA, NIF, Wi-Fi, QR code (ou «código QR»).

### 8.4 Glossário do produto
**Reparação** (a unidade de trabalho; não «trabalho» nem «job») · **Ficha de reparação** (o papel) · **Receção** (o passo de entrada) · **Orçamento** · **Peças** · **Serviços** · **Caixa** · **Clientes** · **Montra** · **Portal de acompanhamento** · **Garantia** · **Levantar** (do lado do cliente) / **Entregar** (do lado da loja) · **Técnico** · **Loja**.

### 8.5 Exemplos de tom

| Situação | Não | Sim |
|---|---|---|
| Sucesso | «Job criado com sucesso!!» | «Reparação R-1045 criada. O cliente recebeu o link por SMS.» |
| Erro de campo | «Campo inválido» | «O IMEI tem 15 dígitos. Faltam 4.» |
| Erro de servidor | «Falha ao criar reparação» | «Não foi possível guardar. A ligação à base de dados falhou; tente outra vez daqui a uns segundos.» |
| Vazio | «No data» | «Ainda não há peças em stock. Adicione a primeira ou importe uma lista.» |
| Confirmação | «Tem a certeza? OK / Cancelar» | «Entregar R-1042 à Ana Silva? Falta receber 129,90 €. [Voltar] [Receber e entregar]» |
| Portal | «Estado da tua reparação» | «Estado da sua reparação» |
| Portal (pronto) | «Job DONE» | «Está pronto! Pode levantar hoje até às 19:00. Por pagar: 129,90 €.» |
| Montra (reserva) | «Request sent» | «Pedido enviado. A loja confirma por telefone, normalmente no próprio dia.» |
| SMS | «Your device is ready» | «TelePronto Porto: o seu iPhone 13 está pronto a levantar. Detalhes: oficinaos.app/t/…» |
| Privacidade | «Ao submeter aceitas os termos» | «Os seus dados são enviados apenas à TelePronto Porto para tratar este pedido. Privacidade» |
| Bem-vindo | «Bem-vindo de volta, Admin» | «Bom dia, Pedro.» (ou «Boa tarde» / «Boa noite», com o nome do perfil) |

---

## 9. Como aplicar em cada superfície

### 9.0 Distribuição dos ficheiros
Copiar esta pasta (ou publicá-la como pacote `@oficinaos/design-tokens`) para cada repositório, por exemplo em `design-system/`. Fontes: copiar `fonts/inter-*.woff2`, `fonts/manrope-*.woff2` e `fonts/jetbrains-mono-*.woff2` para a pasta pública de cada projeto. Um `fonts.css` de exemplo:

```css
@font-face { font-family: "Inter Variable"; src: url("/fonts/inter-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Inter Variable"; src: url("/fonts/inter-latin-ext.woff2") format("woff2"); font-weight: 100 900; font-display: swap; unicode-range: U+0100-024F, U+1E00-1EFF, U+20A0-20AB, U+20AD-20C0, U+2C60-2C7F, U+A720-A7FF; }
/* repetir para "Manrope Variable" e "JetBrains Mono Variable" */
```

### 9.1 App (React/Vite, Tailwind 4): `src/app.css`

**Fase 1, sem tocar em componentes (1 PR):**
```css
@import "tailwindcss";
@import "../design-system/fonts.css";
@import "../design-system/tokens.css";
@import "../design-system/tokens.theme.css";
@import "../design-system/compat-app-material.css"; /* mapeia surface-container-*, on-surface-variant, … */
```
- Apagar o bloco de cores e fontes do `@theme` atual (de `--color-on-secondary-container` até `--font-family-mono`) e o `--shadow-premium`. Manter as animações.
- Retirar `.atelier-gradient` (passa a `bg-primary`) e `.blueprint-pattern` (passa a `bg-surface-2`), ou fazê-los apontar para tokens.
- Remover os pacotes `@fontsource/karla*` e adicionar `@fontsource-variable/inter` (ou usar os `woff2` locais).
- O resultado é toda a app com a paleta nova, o Inter e **o modo escuro a funcionar** através de `data-theme`. Falta o seletor em Perfil e o script *anti-flash* no `index.html`:
```html
<script>try{var t=localStorage.getItem('oos-theme');if(t&&t!=='system')document.documentElement.dataset.theme=t}catch(e){}</script>
```

**Fase 2, componentes:**
- `status-colors.ts`: substituir por `bg-status-<slug>-bg text-status-<slug>-fg` e `bg-status-<slug>-dot`, e acrescentar `icon` (Lucide) por estado (§3.2).
- Criar `Button`, `Field`, `Select`, `StatusChip`, `DataTable` (com `density="dense|comfy"`, automático por `pointer: coarse`), `Dialog` (com `<dialog>`), `Toast` e `EmptyState` com as regras de §4.
- Trocar Material Symbols por `lucide-react`, ecrã a ecrã (tabela em §7).
- Capitalização e copy: aplicar §8 (`pt.json`).

**Fase 3:** apagar `compat-app-material.css` quando já ninguém usar os nomes Material (verificar com `grep -r "surface-container\|on-surface" src`). Atualizar `DESIGN.md`/`DESIGN.json` para remeterem para este documento.

### 9.2 Site (Astro, Tailwind 4): `src/styles/global.css`
```css
@import "tailwindcss";
@import "../../design-system/fonts.css";
@import "../../design-system/tokens.css";
@import "../../design-system/tokens.theme.css";
```
- O site passa a **claro por omissão**, com modo escuro pelo sistema. O preto + teal sai. O teal fica como `accent`, só para «grátis» e destaques, nunca em botões.
- Substituir `zinc-*` → `text`/`text-muted`/`border`/`surface-*`, `teal-*` → `primary` (CTA) ou `accent` (destaque), e `focus:outline-teal-400` → `focus-visible:shadow-focus`. O seletor de idioma ativo fica `bg-primary text-on-primary` (resolve o B-5).
- Logótipo: `public/favicon.svg` ← `logos/a-favicon.svg`. Os componentes de cabeçalho e rodapé usam `a-lockup-light.svg`/`-dark.svg` com `<picture>` + `prefers-color-scheme`, ou o SVG *inline* com `fill="currentColor"` no «Oficina».
- Gerar de novo `og-cover-{pt,en,es}.png` e `fb-cover-*` com o lockup novo. Criar a página `/brand` com o lockup, as cores e as regras de §2 (para imprensa e parceiros).

### 9.3 Cloud (HTML estático em `public/*.html`)
- Servir `tokens.css`, `shop-accent.js` e as fontes em `/assets/` (acrescentar ao mapa de ficheiros em `src/app.ts`, que hoje só serve `karla-latin.woff2` e `manrope-latin.woff2`). Cabeçalho `Cache-Control: public, max-age=31536000, immutable` com o nome do ficheiro versionado (`tokens.v1.css`).
- Em cada página: `<link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>` + `<link rel="stylesheet" href="/assets/tokens.v1.css">`. **Retirar o Google Fonts.**
- Substituir as variáveis locais (`--primary:#0040a1`, `--canvas`, `--ink`, `--muted`, `--outline`, …) por `var(--oos-*)`:
  - `portal.html`, `storefront.html`, `storefront-compacta.html`: o servidor injeta no `<html style="…">` as variáveis de `shopAccentVars(shop.accent)` e no cabeçalho o logótipo/nome da loja. O rodapé fica como em §6.2. Os estados usam `--oos-status-*`.
  - `index.html` (painel da loja): **sai o verde-néon `#33ff66` e o monospace.** O painel usa os tokens claro/escuro, a tipografia Inter/Manrope e o lockup OficinaOS no topo. O admin interno (`/admin`) pode manter uma variante densa, mas com os mesmos tokens.
  - `privacy.html`: o mesmo layout e cabeçalho do site, em páginas separadas por língua.
- Sem *build step*: as classes são CSS simples sobre as variáveis (`.btn-primary{background:var(--oos-color-primary);color:var(--oos-color-on-primary)}`). Se um dia houver *build*, usar `tokens.theme.css` com Tailwind 4.

### 9.4 Recibos, etiquetas e PDF
Sempre em claro e em `text` sobre branco. Logótipo e nome da loja no topo, código da reparação em JetBrains Mono, valores tabulares, «Este documento não serve de fatura» quando aplicável e «Emitido com OficinaOS» em 7 pt no rodapé.

### 9.5 Plano sugerido
1. Semana 1: fontes locais + tokens + compat na app (modo escuro grátis) + favicon e logótipo novos nas 4 superfícies.
2. Semana 2: portal e montra com a marca da loja e `shop-accent` + painel Cloud sem néon.
3. Semanas 3–4: componentes base na app (Button, Field, StatusChip, DataTable denso, Dialog, Toast, EmptyState) + Lucide + revisão de copy PT-PT.
4. Depois: site claro, página `/brand`, OG por língua, apagar a camada de compatibilidade.

---

## 10. Lista de verificação de acessibilidade (por PR)
- Contraste: texto ≥ 4,5:1, texto grande e não-texto ≥ 3:1, em claro **e** escuro (correr `python3 src/contrast.py` se mudarem tokens).
- Foco visível em tudo o que é interativo. Ordem de tabulação lógica. `<dialog>` para modais.
- Alvos ≥ 44×44 em `pointer: coarse` (hoje o select de técnico tem 26 px e as ações de peça 18 px).
- Labels associadas, erros com `aria-describedby` e mensagens com `role="status"`/`aria-live`.
- Estado sempre com ícone + texto. Nunca só cor.
- Sem *overflow* horizontal a 360/390/768 px (teste Playwright `scrollWidth <= innerWidth`).
- `lang="pt-PT"` (ou `en`/`es`) correto no `<html>`.

---

## 11. Ficheiros desta pasta
| Ficheiro | O que é |
|---|---|
| `boards/board-a.png`, `board-b.png`, `board-c.png` (+ `@2x`, + `.html`) | Quadros das três direções, 1600×1000 |
| `logos/{a,b,c}-symbol.svg`, `-symbol-dark.svg`, `-favicon.svg`, `-lockup-light.svg`, `-lockup-dark.svg` | Logótipos em SVG com o texto convertido em contornos |
| `tokens.css` | Variáveis CSS `--oos-*`, claro + escuro (sistema, `data-theme`, `.dark`) |
| `tokens.theme.css` | Mapa `@theme inline` para Tailwind 4 (app e site) |
| `tokens.preset.js` | Preset Tailwind (v3 `presets:[]` ou v4 `@config`) + valores hex em `preset.tokens` |
| `compat-app-material.css` | Nomes Material 3 da app → tokens novos (migração sem reescrever ecrãs) |
| `shop-accent.js` | Cor da loja com contraste automático (servidor ou browser) |
| `contrast-report.md` | Todos os pares verificados, por direção e modo |
| `fonts/` | Inter, Manrope, JetBrains Mono (+ as da B e da C), em woff2 variável, latin + latin-ext (OFL) |
| `src/` | Geradores: `directions.py` (fonte de verdade), `gen_tokens.py`, `logos.py`, `boards.py`, `contrast.py` |

# Spike A0 — Atendimento IA para qualquer empresa: três perguntas, com evidência

Data: 2026-11-26. Base: `plano-atendimento-ia.md` v1 (linhas 13, 51, 68-69 e 93).
Código e dados de teste ficaram fora dos repositórios (pasta de rascunho), como combinado.
**Nenhum número real de cliente foi ligado** — todos os testes com a Evolution usaram sessões por
emparelhar (sem QR lido).

---

## 1. Evolution alojada multi-sessão

### O que é

A [Evolution API](https://github.com/EvolutionAPI/evolution-api) (v2.x) é um servidor Node.js que
usa a biblioteca **Baileys** (WhatsApp Web multi-device, não-oficial) e expõe REST + webhooks.
Uma única instalação aguenta **muitas instâncias** (uma sessão WhatsApp = um número = um cliente
nosso), cada uma com o seu QR, o seu token e o seu webhook. Persiste sessões em Postgres.

### Medição local (evidência própria)

Setup: contentor oficial `evoapicloud/evolution-api:v2.3.8` + Postgres 16 em Docker, sem números
reais. Resultados:

| Medição | Valor |
|---|---|
| RSS base (0 instâncias) | **224 MB** |
| 10 instâncias criadas (à espera de QR, com websocket ligado aos servidores WhatsApp) | 255 MB (+3 MB/instância) |
| 50 instâncias | 286 MB (**+1,2 MB/instância** sobre o base) |
| CPU com 50 instâncias em espera | ~2 % |
| Restart do contentor | as 50 instâncias **sobrevivem** (persistidas em Postgres) e voltam ao estado de ligação sozinhas. ⚠️ Prova apenas a persistência do *registo* e a retoma de sessões **não emparelhadas** — se um número já ligado retoma as mensagens após restart sem novo QR **não foi testado** (exige número real) e é verificação obrigatória do piloto |
| RSS após o restart (50 instâncias a religarem-se) | 326 MB — cresceu ~40 MB no churn, consistente com os relatos de leak (ver riscos) |

**Leitura honesta:** o plano de gestão (criar, guardar, vigiar instâncias) é barato — cêntimos de
memória por cliente. Mas uma sessão **por emparelhar** quase não tem estado: o custo real está na
sessão **emparelhada** (chaves sincronizadas, store de chats em memória, tráfego de mensagens), que
não podemos medir sem ligar um número real. Para esse custo usamos números publicados por operadores
(ver abaixo) — e devemos medi-los nós mesmos no piloto A3, com 1-2 empresas reais.

### Capacidade por servidor — números publicados

- [Runstack — múltiplas instâncias num servidor](https://runstack.com.br/evolution-api-multiplas-instancias) (consultado 2026-11-26):
  instância em idle **~80–120 MB RAM**; uso moderado (100–500 msgs/dia) **~120–200 MB**; uso intenso
  com grupos/média **200–400 MB**. 10–15 instâncias em uso moderado numa VPS de 4 GB; 25–40 numa de 8 GB.
- [Rollin Host — multi-instância](https://www.rollinhost.com.br/en/docs/evolutionapi/multi-instancia) (consultado 2026-11-26):
  ~400 MB por instância na configuração deles (com n8n no mesmo host — número inflacionado);
  a partir de 20 instâncias recomendam servidor dedicado; acima de 50, sharding por `instanceName`.
- Issue [#2752](https://github.com/evolution-foundation/evolution-api/issues/2752) (consultado 2026-11-26):
  com ~400 instâncias o heap cresce **linearmente ~90 MB/hora** até rebentar — leak real na v2.3.7,
  ainda aberto. Muitas instâncias presas em `connecting` agravam o consumo.

**Número de trabalho para o modelo de custo:** 120–200 MB por sessão emparelhada em uso moderado
+ ~1 GB de overhead fixo (base Node + Postgres + Redis no mesmo host).

### Custo mensal estimado (Hetzner, preços lista net verificados nov/2026)

Referências: CX22 2vCPU/4 GB €4,49; CX32 4vCPU/8 GB €8,49; CX43 8vCPU/16 GB €15,99
([cloudtally.eu, verificado 2026-11-10](https://cloudtally.eu/hetzner-cloud-prices), consultado 2026-11-26).
Contas: consumo cru de **160 MB/sessão** (ponto médio do intervalo publicado para uso moderado,
120–200 MB) + 1 GB fixo por host, e dimensionamento com **~50 % de margem** para picos e leak —
**só servidor, sem custo operacional**:

| Clientes | RAM crua | Com margem ×1,5 | Servidor | Custo/mês | Por cliente/mês |
|---|---|---|---|---|---|
| 10 | 1 + 1,6 ≈ 2,6 GB | 3,9 GB | CX22 (4 GB) €4,49 — no limite, sem folga operacional | ~€4,50–8,50 | **~€0,45–0,85** |
| 50 | 1 + 8 ≈ 9 GB | 13,5 GB | CX43 (16 GB) €15,99 | ~€16 | **~€0,32** |
| 200 | 1 + 32 ≈ 33 GB | 49,5 GB | 4× CX43 (64 GB) com sharding | ~€64 | **~€0,32** |

Notas de honestidade nas contas:
- o consumo real por sessão emparelhada é **a maior incógnita do modelo de custo** — se ficar no
  topo do intervalo (200 MB), nem 4 hosts de 16 GB cobrem 200 clientes com a margem (precisaria de
  5); se ficar no fundo (120 MB), 3 chegam. O intervalo por cliente é por isso **~€0,24–0,40** no
  cenário grande. Medir RAM real no piloto não é opcional: é o que decide estas contas.
- o CX22 no cenário de 10 clientes fica sem folga operacional com o ponto médio — na prática o
  primeiro host deve ser um CX32 (8 GB), o que duplica o custo por cliente nos primeiros 10
  clientes. Os primeiros clientes subsidiam-se a si próprios: é o preço de arrancar.

Aos preços comerciais do plano (dezenas de €/mês por cliente), o custo de infraestrutura WhatsApp é
**irrelevante** — o custo real desta opção não é dinheiro, é risco (ver abaixo).

### Estabilidade e risco de bloqueio do número

A parte mais importante do spike:

1. **O risco de banimento é real e não controlável.** A Baileys usa o protocolo WhatsApp Web sem
   autorização da Meta — viola os termos do WhatsApp. Issue
   [#2693](https://github.com/evolution-foundation/evolution-api/issues/2693) (consultado 2026-11-26):
   instância **só com atendimento inbound legítimo** (zero spam, com presença simulada e debounce)
   foi desligada com `401 device_removed` e o número levou **restrição temporária de 24 h** por
   "aplicação não oficial detetada". Ou seja: mesmo fazendo tudo "bem", o número do cliente pode ser
   bloqueado — e para um café ou clínica **o WhatsApp é o canal principal do negócio**.
2. **Códigos de desligamento** (análise da fonte v2.3.8, via
   [nuvits.net, 2026-11-24](https://nuvits.net/en/blog/evolution-api-disconnecting-no-qr-code-docker)):
   `401` = sessão revogada (não religa — novo QR); `440` = dois processos com a mesma sessão;
   `515` = reset esperado após QR (religa só); `408` = timeout. A v2.3.7 tinha um bug de ~50 min
   `stream errored out` **corrigido na v2.3.8** — correr sempre a versão corrigida.
3. **Persistência de registo confirmada no nosso teste** (restart não perde instâncias — desde que
   em Postgres); a retoma de sessões **emparelhadas** sem novo QR resta por provar no piloto.
4. Sessões que caem para `connecting` sem emparelhar acumulam leak de memória (issue #2752) —
   operação tem de limpar/expirar sessões nunca emparelhadas.

### Isolamento entre clientes — o que falta

Fonte: [auth.guard.ts da v2](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/guards/auth.guard.ts)
e [guia Railway multi-instance](https://railway.com/deploy/evolution-api-multi-instance.md) (ambos consultados 2026-11-26).

- **Existe isolamento de credencial:** cada instância tem token próprio; o token de uma instância só
  autentica rotas dessa instância (`instance.token === key` + match do `instanceName`). A chave
  global abre tudo — **nunca** sair da nossa Cloud.
- **Webhooks por instância** (cada cliente com o seu endpoint/eventos) — por desenho.
- **Na nossa arquitetura o cliente nunca fala com a Evolution** — só a Cloud fala. O isolamento
  efetivo é o da nossa API, não a da Evolution. Isto fecha o maior buraco.
- **O que falta / não existe:**
  1. **Sem quotas por instância** — uma sessão em looping ou um leak degrada todas as outras no mesmo
     processo (partilham heap Node). Mitigação: limites de memória do contentor + watchdog +
     sharding cedo (vários contentores pequenos em vez de um grande — blast radius menor).
  2. **IP de saída partilhado** — os números são banidos individualmente, mas a reputação de rede é
     comum: padrões de spam de um cliente são visíveis no mesmo IP dos outros. Mitigação: termos de
     uso contratuais + rate limiting nosso + deteção de envio em massa. Isto **não** se resolve
     tecnicamente.
  3. **QR pairing na consola** — o fluxo de ligar por QR precisa de ser desenhado para o dono da
     empresa (sessão Bootstrap, expiração, retry) — trabalho do A3.
  4. **Sem HA** — um contentor é SPOF; com sharding manual a recuperação é operacional.

### Recomendação (pergunta 1)

**Viável para o piloto, com WhatsApp oficial como caminho de escape desde o desenho.**
O custo financeiro é trivial e a operação é exequível (persistência confirmada, reconexão automática,
isolamento suficiente com a Cloud como único cliente da API). **Mas o risco de banimento é o risco
do produto:** não o podemos eliminar, e acontece até a quem só recebe. Por isso:

- vender a versão Evolution como "ligaçãa rápida" **com o risco explicitado no contrato/onboarding**;
- ter WhatsApp oficial (Meta) como upgrade pago desde o A5 — quem não pode arriscar o número migra;
- nunca prometer estabilidade de número na comunicação comercial;
- medir memória real por sessão emparelhada no piloto A3 antes de escalar além de ~20 clientes por host.

**Riscos:** banimento do número do cliente (alto impacto, probabilidade desconhecida mas documentada);
leak de memória em escala (médio, mitigável com watchdog/sharding); dependência de projeto
open-source com mudanças de licença/governação recentes (evolution-foundation).

---

## 2. `procurar_faq` sem vetores — benchmark

### Método

Postgres 14 local, extensões `pg_trgm` + `unaccent`. Dataset construído para o spike:
**30 perguntas/respostas de um café + 30 de uma clínica** (PT-PT realista) e **40 perguntas de
cliente** escritas à mão de forma propositadamente má — erros de ortografia, sem acentos,
abreviaturas ("q", "pa", "pq", "cm", "hj"), formulações coloquiais. Cada pergunta mapeada à P/R
correta; a pesquisa corre sempre dentro do tenant certo (como no produto). Medimos quantas vezes a
resposta certa aparece no **top-3** (o que o assistente usaria).

### Resultados (40 perguntas)

| Método | hit@1 | hit@3 | % top-3 |
|---|---|---|---|
| FTS `portuguese` só na pergunta | 17 | 23 | 58 % |
| FTS `simple`+unaccent na pergunta+resposta | 26 | 30 | 75 % |
| **trigram só na pergunta** | 31 | 34 | 85 % |
| **trigram na pergunta+resposta** | 29 | **38** | **95 %** |
| trigram + fts híbrido | 32 | 36 | 90 % |
| word_similarity (pg_trgm) q+a | 32 | 37 | 92 % |
| trigram q+a com boost na pergunta | **35** | 36 | 90 % |  ← melhor hit@1, pior top-3: o boost reordena mas expulsa candidatas certas do top-3

### Onde falha — e porquê

Os erros residuais (6 a 10 %) **não são de digitação** — são **paráfrases sem sobreposição lexical**:

- «posso levar o meu cão?» → a resposta certa é «Aceitam animais?» — **zero** palavras comuns;
- «se estiver muito mal posso ir aí sem marcar?» → «Atendem urgências?» — idem;
- «aceitam adse?» → «Têm acordo com seguros de saúde?» — a sigla não aparece na pergunta,
  só na resposta (daí q+a ser melhor que só-q).

Nenhum ranking lexical resolve sinónimos que não partilham letras. **É exatamente este o caso que o
pgvector cobre** — embeddings capturam "cão ≈ animais", "sem marcar ≈ urgência".

### Avisos de método (honestidade)

- As 40 perguntas fui eu que as escrevi — não são tráfego real. O número absoluto (95 %) é
  **otimista**; o que interessa é a *forma* dos erros (paráfrase sem overlap), que é estrutural.
- Dataset pequeno (30 P/R por negócio) — com 100+ P/R o ruído de ranking aumenta um pouco.
- O benchmark mede **recall de retrieval**: se a resposta certa chega ao LLM no top-3. **Não mede**
  se o LLM a escolhe e usa corretamente — isso depende do prompt e do modelo e fica por testar no
  A2. Pela mesma razão, a afirmação de que a ordem dentro do top-3 é irrelevante é um **pressuposto
  razoável mas não verificado** (LLMs têm algum viés de posição); a decisão de não otimizar hit@1
  deve ser revista se no piloto o assistente escolher a candidata errada com as três à frente.
- O assistente nunca responde diretamente da pesquisa: o LLM recebe as 3 candidatas **e a ficha** —
  um top-3 imperfeito com um "não inventes" bem posto degrada com graciosidade para `pedir_humano`,
  não para resposta errada.

### Recomendação (pergunta 2)

**Chega sem pgvector para o MVP (A1–A3): trigram `pg_trgm` simples sobre pergunta+resposta** —
95 % de top-3 no benchmark. Como `procurar_faq` devolve 3 candidatas ao LLM, o que conta é o
top-3, e aí a variante simples ganha à variante com boost na pergunta (38/40 contra 36/40; o boost
melhora o hit@1 — 35/40 — mas o top-1 é irrelevante quando o LLM lê as três). Custa zero de
infraestrutura nova (já temos Postgres), indexa com `gin_trgm_ops`, e os erros residuais são
semanticamente "impossíveis" para qualquer método lexical — não vale a pena afinar mais sem vetores.

**pgvector fica como upgrade decidido por dados:** se no piloto as falhas de FAQ forem visíveis
(>5–10 % das conversas a cair em `pedir_humano` por falta de match), o custo de adicionar a extensão
+ embeddings por P/R é pequeno e incremental — a ferramenta `procurar_faq` não muda de interface.
Nota: pgvector exige chamada de embeddings por P/R indexada (custo de IA marginal) — coerente com o
modelo BYOK/incluído.

---

## 3. Google Places — termos de uso

**Pergunta:** podemos ler o perfil público de uma empresa (horário, morada, telefone) para
pré-preencher a ficha dela, com o consentimento do dono?

### Resposta: **NÃO — nem com consentimento do dono.**

Fontes oficiais (consultadas 2026-11-26):

1. **Google Maps Platform Terms of Service, §3.2.3(a) "No Scraping"**
   ([cloud.google.com/maps-platform/terms](https://cloud.google.com/maps-platform/terms)):
   *"Customer will not export, extract, or otherwise scrape Google Maps Content for use outside the
   Services. For example, Customer will not: (i) **pre-fetch, index, store**, reshare, or rehost
   Google Maps Content outside the services; (ii) bulk download … places information …; or
   (iii) **copy and save business names, addresses, or user reviews**"*.
2. **§3.2.3(b) "No Caching"**: proibido cachear Google Maps Content fora das exceções das Service
   Specific Terms.
3. **Places API policies**
   ([developers.google.com/maps/documentation/places/web-service/policies](https://developers.google.com/maps/documentation/places/web-service/policies),
   consultado 2026-11-26): as únicas exceções de armazenamento são **place ID** (indefinidamente) e
   **latitude/longitude** (até 30 dias, em alguns serviços). Horário, morada, telefone, nome —
   **nunca** podem ser gravados.

Pré-preencher a ficha é exatamente "copy and save business names, addresses" + "store places
information" — as duas proibições nomeadas explicitamente. **O consentimento do dono da empresa não
muda nada**: a restrição é da licença entre nós e a Google, não um direito do negócio listado.
O dono não é dono dos dados no sentido de os poder licenciar — a Google compilou-os e licencia o
acesso, não a cópia.

### Alternativas legais

| Caminho | Como funciona | Estado legal |
|---|---|---|
| **Google Business Profile API** (OAuth do dono) | O dono liga a sua própria ficha Google com `business.manage`; lemos o perfil **dele** | ✅ **Permitido** — [policies](https://developers.google.com/my-business/content/policies) (consultado 2026-11-26): as APIs servem exatamente para gerir perfis "que possuis ou estás autorizado a gerir em nome do dono". Exige: app OAuth verificada pela Google, consentimento explícito, e dados revalidados (não é cópia one-shot para usar para sempre — fonte secundária indica cache ≤ 30 dias). |
| **Site da própria empresa** (já no plano, §4 do plano) | O agente de configuração lê o site dela — horários, morada, serviços costumam lá estar | ✅ Permitido — é o site do próprio cliente, com robots.txt respeitado. **É a fonte principal realista.** |
| **Perguntas do agente** (já no plano — máx. 6) | O que falta, pergunta-se ao dono | ✅ Trivial |
| Places API só para **exibição** live (mapa na ficha) | Mostrar o mapa Google com place ID guardado, dados pedidos em runtime e nunca gravados | ✅ Permitido dentro das regras (place ID isento), se alguma vez for útil — mas não serve para pré-preencher |

### Recomendação (pergunta 3)

**Não usar Google Places para pré-preencher — proibido nos termos, mesmo com consentimento.**
O agente de configuração (A4) usa: **1) o site da empresa** (fonte principal), **2) as perguntas ao
dono**. Como melhoria posterior, e se o volume justificar o processo de verificação OAuth da Google,
**a ligação à Google Business Profile do próprio dono** é o caminho legal para importar horário/
morada/telefone verificados — é trabalho extra de integração (OAuth + verificação da app), por isso
fica fora do A4 exceto se o mentor decidir o contrário.

---

## Síntese e estimativa para o A1

| Pergunta | Recomendação | Confiança |
|---|---|---|
| 1. Evolution multi-sessão | **Avançar** para piloto; custo ~€0,24–0,40/cliente/mês no cenário grande (200 clientes em 3–4 hosts, conforme o consumo real de RAM); nos primeiros 10 clientes ~€0,45 (host mínimo, sem folga) ou ~€0,85 (host com folga — recomendado); risco de banimento declarado no contrato; oficial Meta como upgrade no A5; medir RAM real de sessões emparelhadas no A3 | Média-alta (evidência própria + publicada) |
| 2. procurar_faq | **Sem pgvector**: trigram simples sobre pergunta+resposta (95 % top-3); pgvector como upgrade decidido por dados do piloto | Alta no mecanismo; média nos números (dataset sintético) |
| 3. Google Places | **Proibido** pré-preencher a partir do perfil público. Fonte = site da empresa + perguntas; GBP API do próprio dono como caminho legal posterior | Alta (texto dos termos é explícito) |

### Estimativa de esforço do A1 (modelo de dados + BusinessProfile + consola com ficha editável à mão)

Referência interna: o WP3 (consola do cliente) levou ~1 sessão longa e o WP1 ~1,5. O A1 é prisma +
migração, endpoints CRUD com isolamento por tenant, e a secção de ficha na consola — sem nada de IA,
sem canais, sem agente.

- **2 a 3 sessões de trabalho** (incluindo iterações de review): migração + modelos (0,5), endpoints
  com testes de tenant (1), UI da consola (1) + reviews.
- Trabalho **não** incluído no A1 mas já identificado: decidir estrutura das regras da ficha
  (reservas/reclamações/temas proibidos como campos estruturados vs texto livre), versionamento de
  ficha (basta versão+data ou histórico navegável?), e o desenho do "aberto agora?" com fuso horário
  e exceções — convém fechar com o mentor antes de começar, porque condiciona o schema.

### Riscos transversais registados para o plano

1. **Banimento WhatsApp** — o risco n.º 1 do produto inteiro; mitigação é contrato + caminho oficial.
2. **Leak de memória Evolution em escala** — watchdog + sharding + medição no piloto.
3. **Qualidade FAQ em produção** — dataset real diverge do sintético; medir taxa de `pedir_humano`
   por falta de match no piloto para decidir pgvector com dados.
4. **A4 sem fonte rica de dados** — sem Places, a qualidade do rascunho depende muito do site da
   empresa; negócios com sites fracos vão precisar de mais perguntas — rever o limite de 6 perguntas
   à luz disto quando o A4 chegar.

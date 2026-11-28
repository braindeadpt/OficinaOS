# FX0 — Investigação da API InvoiceXpress

> Documento de investigação (sem código). Cada ponto responde com link para a
> documentação oficial e exemplo de pedido/resposta. Nota de versões: existem
> **duas APIs** —
> **v2** (`https://<conta>.app.invoicexpress.com/….json`, a que a integração
> atual usa em `server/services/invoicing.service.ts`) e **v3**
> (`https://api-v3.app.invoicexpress.com/api/v3/…`, mesma autenticação por
> `api_key` na query string). A pesquisa de clientes por texto **só existe na v3**; os pagamentos parciais estão documentados nas duas — a v3 acrescenta a garantia de idempotência (`Idempotency-Key`). A migração
> da v2 para a v3 está em curso do lado deles
> ([changelog](https://invoicexpress.com/changelog-api/)).

## 1. Webhooks e listagem de documentos alterados

**Não existem webhooks nativos.** Evidência:

- A superfície da API v3 enumera todas as secções (documentos, séries,
  clientes, itens, impostos, conta, SAF-T, EDI…) e não há nenhuma secção de
  webhooks nem de subscrição de eventos
  ([visão geral v3](https://docs.invoicexpress.com/v3)).
- A integração oficialmente mantida na Unified.to marca `Webhooks: none`
  para todos os objetos InvoiceXpress
  ([docs.unified.to/integrations/invoicexpress](https://docs.unified.to/integrations/invoicexpress.md)).
- Os integradores de terceiros (ex. pacote Laravel) implementam "webhooks"
  do lado do cliente por polling — não há push do fornecedor.

**Alternativa — polling com filtros e paginação.** Não há filtro por
«alterado desde» (`updated_since`). Os filtros da listagem são
`id[]`, `except_id[]`, `type[]`, `status[]`, `client_id[]`, `serie_name[]`,
`date[from/to]`, `due_date[from/to]`, `total_before_taxes[from/to]`,
`total_with_taxes[from/to]`, `text`, `archived`, `non_archived`,
`reference`, mais paginação (`page`, `per_page`)
([List Invoices v3](https://docs.invoicexpress.com/v3/invoices/listv3invoices),
[List all v2](https://invoicexpress.com/api-v2/invoices/list-all/)).

Consequência para o FX6: a sincronização tem **duas pernas**: (a) **descoberta** — varrimento paginado por janela de data de emissão, **sem filtro de `status`** (filtrar por `sent` excluiria anuladas e liquidadas), para apanhar documentos novos emitidos fora da app; (b) **refresco** — consulta por ID (`id[]`) dos documentos já associados, incluindo arquivados, porque uma fatura de outubro anulada em novembro **não entra** na janela de novembro (a data do documento não muda quando o estado muda). Comparação por `status`/`final_date`. Custo é baixo: uma loja emite poucos documentos por dia e o
limite é generoso (ver §9).

Exemplo de pedido (v3):

```
GET https://api-v3.app.invoicexpress.com/api/v3/invoices?api_key=KEY&type[]=Invoice&date[from]=01/11/2026&date[to]=30/11/2026&page=1&per_page=30
```

Exemplo de resposta (v3 — a forma difere da v2: paginação em `totals.pages`, link público em `token` em vez de `permalink`, e estados como `sent`/`final`/`settled`/`canceled`; `final_date` está documentado nesta versão):

```json
{
  "invoices": [
    {
      "id": 541793,
      "status": "sent",
      "type": "Invoice",
      "sequence_number": "28/A",
      "reference": "fb30",
      "date": "27/06/2017",
      "final_date": "27/06/2017",
      "total": 1.07,
      "token": "541793e1ab"
    }
  ],
  "totals": { "count": 6, "pages": 1, "statuses": [], "total_drafts": 0, "total_canceled": 0 }
}
```

## 2. Notas de crédito e anulação

**Nota de crédito:** cria-se como documento do tipo `credit_notes` no mesmo
endpoint de criação, com `owner_invoice_id` a ligar ao documento original
(e o campo `raw_owner_invoice` na resposta mostra o número legível, ex.
`FT 2026/253`)
([Create v2](https://invoicexpress.com/api-v2/credit-notes/create/),
[Create v3](https://docs.invoicexpress.com/v3/invoices/createv3invoice)).

```json
POST /credit_notes.json?api_key=KEY
{
  "credit_note": {
    "date": "28/11/2026",
    "due_date": "28/11/2026",
    "owner_invoice_id": 541673,
    "client": { "name": "Cliente Lda", "code": "OFX-abc123" },
    "items": [
      { "name": "Reparação ecrã iPhone 12", "description": "devolução", "unit_price": "79.9", "quantity": "1" }
    ]
  }
}
```

Depois de criada em rascunho, finaliza-se com change-state (tal como as
faturas). Nota: em Portugal a nota de crédito tem de referenciar o documento
original — a ligação `owner_invoice_id` cobre isso; linhas parciais são
possíveis porque os itens são livres.

**Anulação (exemplo v2):** `PUT /:tipo/:id/change-state.json` com
`{"invoice": {"state": "canceled", "message": "motivo"}}` — o motivo é
**obrigatório** (sem ele a API responde 422)
([Change-state v2](https://invoicexpress.com/api-v2/invoices/change-state/),
[Change document state v3](https://docs.invoicexpress.com/v3/invoices/changev3invoicedocumentstate)).
Na **v3** o caminho é `/api/v3/{invoices-type}/{id}/change-state.json` e a **chave do corpo tem de ser o singular do tipo do documento** (`invoice` para invoices, `invoice_receipt` para invoice_receipts, `simplified_invoice`, `credit_note`, `debit_note`) — outra chave devolve 422. `finalized` é o **comando** enviado no corpo para finalizar um rascunho: o estado resultante é `final` (todos os tipos) ou `settled` (só fatura-recibo, paga à nascença). Transições: `final → canceled` (todos os tipos), `settled → canceled` (só fatura-recibo). Um documento finalizado **nunca se apaga** — anula-se com
motivo, como manda a lei fiscal.

```json
PUT /invoices/541674/change-state.json?api_key=KEY
{ "invoice": { "state": "canceled", "message": "Documento emitido por engano" } }
```

## 3. Fatura + recibo separados, pagamentos parciais e adiantamentos

Hoje a app emite **fatura-recibo** (paga à nascença). O modelo «fatura +
recibo» existe e é por documento:

1. Emite-se **fatura** (`invoices`) — fica `final` com valor em dívida.
2. Cada pagamento regista-se com **`POST /documents/{document_id}/partial_payments.json`** — documentado na [v2](https://docs.invoicexpress.com/v2/invoices/generatepayment) (host `<conta>.app.invoicexpress.com`) e na [v3](https://docs.invoicexpress.com/v3/invoices/createv3documentpartialpayment) — e cada pagamento **gera um recibo** (`Receipt`, documento fiscal próprio) ligado à fatura
   ([Create partial payment](https://docs.invoicexpress.com/v3/invoices/createv3documentpartialpayment)).

```json
POST /api/v3/documents/541674/partial_payments.json?api_key=KEY
Idempotency-Key: 6f1c2a4e-1b7d-4c55-9a0e-3f2b8d7c9e10
{ "partial_payment": { "amount": 150.5, "payment_date": "15/01/2024", "payment_mechanism": "TB", "note": "Pagamento fatura 123" } }
```

Resposta: objeto `receipt` com `sequence_number`, `total`, `atcud` etc.
O campo `payment_mechanism` aceita códigos como `TB` (transferência), `MB`
(multibanco), `CC` (cartão). O header **`Idempotency-Key`** torna retries seguros (replay da primeira resposta durante 24 h) — está documentado na v3, confirmar em sandbox se a v2 o honra; importante para a regra «nunca emitir documento em duplicado» do plano.

**Adiantamentos:** não existe tipo de documento «adiantamento». O desenho
possível é: recibo/fatura-recibo do adiantamento no momento do pagamento e
fatura final com referência — **com limitações**: a articulação fiscal correta
(adiantamento vs. fatura-recibo parcial) precisa de validação com o
contabilista do dono, tal como o plano já prevê para a margem.

## 4. Taxas por linha e motivos de isenção (incl. regime da margem)

Cada item pode levar a sua taxa por nome (`tax: {"name": "IVA23"}` —
`IVA23`, `IVA13`, `IVA6`, `IVA0` conforme a zona); se a taxa não existir,
aplica-se a taxa padrão do item/conta
([Create v2 — Request Body](https://invoicexpress.com/api-v2/invoices/create/)).
Para itens isentos (IVA 0%) contas portuguesas **têm de enviar o motivo**:
campo `tax_exemption` ao nível do documento com o código M da tabela oficial
([Appendix — IVA Exemption Codes](https://invoicexpress.com/api-v2/documentation/appendix/)).

```json
{ "invoice": {
    "tax_exemption": "M13",
    "items": [ { "name": "iPhone 11 usado", "unit_price": "250", "quantity": "1", "tax": { "name": "IVA0" } } ]
} }
```

**Regime especial da margem (bens em segunda mão):** código **M13** —
«Regime da margem de lucro – Bens em segunda mão» (DL 199/96). Na prática,
no InvoiceXpress: item com IVA 0% + motivo M13 no documento, e a menção
legal sai impressa na fatura
([blog InvoiceXpress — motivos de isenção](https://invoicexpress.com/blog/motivos-isencao-iva/)).
**Com limitações importantes:** no regime da margem o IVA incide sobre a
margem (venda − compra) e **não é discriminado no documento** — a API não
calcula nada sobre a margem: o cálculo é inteiramente do nosso lado (FX1)
e o documento apenas transporta a menção legal. Validar com o contabilista
antes de ativar, como o plano já impõe. Nota: a isenção é por documento, não
por linha — uma fatura mista (margem + serviços com IVA normal) usa o motivo
do documento para as linhas isentas; confirmar em sandbox como o PDF apresenta
a mistura.

## 5. Clientes: procurar por NIF, atualizar, código próprio

- **Código próprio:** o campo `code` é o identificador do cliente do lado da
  loja (a integração atual já envia `OFX-<id>`)
  ([Create client fields](https://invoicexpress.com/api-v2/clients/update-4/)).
- **Procurar por NIF:** na **v3** a listagem aceita `term` que casa por
  contenção em `name`, `fiscal_id`, `email` ou `code`
  ([List Clients v3](https://docs.invoicexpress.com/v3/clients/listv3clients)):

```
GET /api/v3/clients?api_key=KEY&term=501234567&status=active
```

  Na **v2** só existe procura exata por código
  (`GET /clients/find-by-code.json?client_code=…`) ou por nome
  (`find-by-name.json`) — **sem procura por NIF**
  ([Find by code](https://invoicexpress.com/api-v2/clients/find-by-code/)).
  Alternativa sem migrar: a [listagem de clientes v2](https://docs.invoicexpress.com/v2/clients/listclients) devolve `fiscal_id` por cliente — dá para percorrer as páginas e comparar o NIF localmente, ao custo de um pedido por página (irrelevante para uma loja com centenas de clientes, dentro dos 780/min). **Com limitações:** o `term` da v3 é «contém», não igualdade — a
  correspondência exata do NIF tem de ser confirmada do nosso lado; e nada
  na API impõe unicidade de `fiscal_id` (a unicidade é regra nossa, FX5).
- **Defeito atual da integração:** ao emitir, a resolução do cliente é por prioridade `id` → `code` → `name`; quando o `code` casa com um cliente existente, **os restantes campos enviados são ignorados** — alterações de email ou NIF não chegam às faturas seguintes ([Create v2 — resolução do cliente](https://invoicexpress.com/api-v2/invoices/create/)). Por isso o FX5 deve fazer **`PUT` do cliente antes de emitir** (sincronizar email/NIF/morada), em vez de confiar no payload do documento.
- **Atualizar:** `PUT /clients/:client-id.json`
  ([Update v2](https://invoicexpress.com/api-v2/clients/update-4/)).
- Criação implícita: ao emitir um documento com um cliente novo, a API cria
  o cliente (ou reutiliza pelo nome/código) — ver risco de duplicados por
  nome no FX5.

## 6. Envio por email e obtenção do PDF

**Email:** `PUT /:tipo/:id/email-document.json` com destinatário, assunto,
corpo, cc/bcc — e opção `save` para gravar o email no cliente
([Send by email](https://invoicexpress.com/api-v2/invoices/send-by-email/)):

```json
PUT /invoices/541674/email-document.json?api_key=KEY
{ "message": { "client": { "email": "cliente@exemplo.pt", "save": "1" },
               "subject": "Fatura Oficina", "body": "Segue a sua fatura." } }
```

**PDF:** `GET /api/pdf/:document-id.json` — **assíncrono**: responde `202`
enquanto gera; repetir até `200` com `{"output": {"pdfUrl": "https://…"}}`
([Generate pdf](https://invoicexpress.com/api-v2/invoices/generate-pdf/)).
`second_copy=true` gera duplicado. Na v3 há ainda o endpoint público
`GET /api/v3/documents/{token}/pdf` — o token do documento dispensa API key
([v3 documents](https://docs.invoicexpress.com/v3/invoices)).

## 7. Descontos, método de pagamento

- **Desconto por linha:** campo `discount` (percentagem 0–100) em cada item
  do pedido de criação — confirmado no schema v2/v3.
- **Desconto global:** documentado no pedido de criação (v2 e v3): objeto `global_discount` com `value_type` (`percentage` ou `absolute`) e `value` ([Create v2](https://invoicexpress.com/api-v2/invoices/create/)). A sandbox serve para comparar totais e arredondamentos (global vs. por linha), não para descobrir o campo.
- **Método de pagamento:** a fatura não tem campo de método; o mecanismo de
  pagamento (`payment_mechanism`: TB, MB, CC…) existe nos **pagamentos/
  recibos** (partial payments v3). Para fatura-recibo (paga à nascença) não
  há campo de método na criação — **limitação** a registar no FX3 (a menção
  pode ir nas observações, se for preciso).
- Existe ainda `mb_reference` na criação para gerar referência Multibanco
  (contas PT com a feature ativa).

## 8. Artigos: criação e atualização implícita pelo create

O create **cria ou atualiza artigos** do catálogo do InvoiceXpress pelo `name` de cada linha: se não existir artigo com esse nome, é criado; **se já existir, o artigo é atualizado com os novos valores — incluindo o preço** ([Create v2 — criação de clientes/artigos](https://invoicexpress.com/api-v2/invoices/create/)).

**Problema na integração atual:** as linhas levam nomes variáveis por reparação/venda (ex.: «Reparação ecrã iPhone 12» com o preço do momento). Resultado: o catálogo da loja no InvoiceXpress enche-se de artigos descartáveis, e quando um nome se repete o preço do artigo é reescrito — poluição e mutação silenciosa do catálogo.

**Proposta para o FX3 — nomes estáveis:** o `name` da linha deve ser estável e genérico, saído de uma lista fechada (ex.: `Serviço de reparação`, `Peça`, `Equipamento recondicionado`, `Serviço de diagnóstico`), eventualmente com o nome do artigo do catálogo interno quando existir; o detalhe variável (modelo, IMEI, descrição da reparação) vai no campo `description` da linha, que é livre e não cria entradas novas no catálogo. Assim o catálogo do InvoiceXpress fica limitado a meia dúzia de artigos estáveis, e o preço por linha continua a ser o do documento.

## 9. Limites de pedidos e sandbox

- **Limite:** 780 pedidos/minuto por conta; excesso → `429` (recomendado
  retry com backoff) ([Request limits](https://invoicexpress.com/api-v2/documentation/request-limits/)).
  Contas em trial têm limite próprio mais baixo (**40/min**) e contas
  sandbox são excluídas dos limites de trial
  ([changelog R152](https://invoicexpress.com/changelog-api/)).
- **Sandbox/demo:** não há ambiente público de teste — cria-se uma conta de
  teste em `web.invoicexpress.com/signup` e pede-se ao suporte
  (support@invoicexpress.com) para a marcar como sandbox; com NIF real podem
  ligá-la ao ambiente de pré-produção da AT (séries/ATCUD fictícios)
  ([knowledge base](https://invoicexpress.helpscoutdocs.com/article/663-is-there-a-test-sandbox-environment)).
- **Idempotência nativa:** `proprietary_uid` no create — um valor repetido
  devolve o documento já criado em vez de duplicar
  ([Create v2 — idempotency](https://docs.invoicexpress.com/v2/invoices)).
  Reforça a regra «nunca emitir em duplicado» do plano (a app pode usar `sale:<id>`/`job:<id>` como uid). A chave é por **emissão**: retries da mesma emissão reutilizam a mesma chave; documentos distintos da mesma venda — ex.: duas notas de crédito parciais — precisam de chaves distintas (`sale:<id>:cn:<n>`), senão a segunda recebe a primeira como resposta.

## 10. Tabela por fase do plano

| Fase | Veredito | Notas |
|---|---|---|
| FX1 — Custo e margem internos | **Possível** | Não depende da API — é todo do lado da app. |
| FX2 — IVA por artigo + regime da margem | **Com limitações** | Taxa por linha por nome: suportado. Margem: IVA 0% + `tax_exemption` M13 com a menção legal impressa; a API **não calcula** o IVA da margem (é nosso, e legalmente o imposto não se discrimina no documento). Motivo de isenção é por documento, não por linha — fatura mista a validar em sandbox. Contabilista antes de ativar, como o plano manda. |
| FX3 — Ecrã «Faturar» | **Possível** | Revisão, desconto por linha, FR vs FT, email com assunto/corpo próprios, PDF com polling 202→200. Ressalvas: desconto global documentado — validar arredondamentos em sandbox; método de pagamento sem campo próprio na fatura (existe nos recibos; observações como alternativa). |
| FX4 — Nota de crédito e anulação | **Possível** | `credit_notes` com `owner_invoice_id` ligado ao original; anulação por change-state `canceled` com motivo obrigatório; documento final nunca se apaga (correto fiscalmente). Devolução ao stock é lógica nossa. |
| FX5 — Clientes por NIF | **Com limitações** | Procura por NIF na v3 (`term` por contenção — validar igualdade do nosso lado) ou, sem migrar, varrimento da listagem v2 (que devolve `fiscal_id`) com comparação local, ao custo de um pedido por página. `code` próprio suportado; update existe. A unicidade do NIF é regra nossa — a API não a impõe; cuidado com a criação implícita de clientes ao emitir (casa por nome). E quando o cliente já existe pelo `code`, os campos do documento são ignorados — o FX5 tem de fazer `PUT` do cliente antes de emitir, senão alterações de email/NIF não chegam às faturas seguintes (defeito da integração atual). |
| FX6 — Sentido inverso (sincronização) | **Com limitações** | Sem webhooks nem filtro «alterado desde»: polling paginado periódico com comparação de `status`/`final_date`. Exequível sem custo relevante ao volume de uma loja e dentro dos 780/min. Documentos emitidos fora da app aparecem na listagem por data — a lista «por associar» é viável. |
| FX7 — Relatório de controlo | **Possível** | É construído sobre o FX6 (polling + comparação de totais/estados); a listagem já traz totais agregados (`totals`) por filtro, o que ajuda a detetar divergências de valor. |
| FX8 — Fatura + recibo, parciais, adiantamentos | **Possível com limitações** | Fatura + recibos por pagamento: suportado na v3 (`partial_payments` gera `Receipt` fiscal ligado, com `payment_mechanism` e `Idempotency-Key`). Pagamentos parciais documentados nas duas versões; a idempotência por `Idempotency-Key` está documentada na v3 (confirmar a v2 em sandbox) — a migração v2→v3 continua recomendada mas não bloqueia. Adiantamentos: sem tipo próprio — desenho fiscal a validar com o contabilista. |

## 11. Recomendações transversais para o FX1+

1. **Planear a migração v2 → v3** (pelo menos nos endpoints novos): pagamentos
   parciais e pesquisa de clientes por texto só existem na v3; a v2 está em
   manutenção/migração pela equipa deles.
2. **Usar `proprietary_uid`** (`sale:<id>`/`job:<id>`) em todos os creates e
   `Idempotency-Key` nos pagamentos — proteção nativa contra duplicados que complementa o claim em memória já existente. Uma chave por emissão, reutilizada apenas nos retries dessa emissão.
3. **Pedir conta sandbox** ao suporte antes do FX3 — todos os testes manuais
   de emissão/email/PDF devem correr lá, nunca na conta real (regra do plano).
4. O tratamento do **PDF é assíncrono** — o FX3 precisa de retry com backoff
   (202 → 200), não de uma chamada única.

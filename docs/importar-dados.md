# Importar e exportar dados

Definições → **Dados**. Só o perfil **OWNER** (`settings:edit`) tem acesso às
rotas `/api/export/*` e `/api/import/*` — a receção e os técnicos recebem 403,
porque estas operações movem dados pessoais em massa (nome, telefone, email dos
clientes).

## Formatos suportados

| Formato | Notas |
|---|---|
| `.csv` | UTF-8; se a decodificação UTF-8 falhar, assume **Windows-1252** (o que o Excel português produz) |
| `.xlsx` | Excel moderno, lido pelo `read-excel-file` |
| `.xls` | **Não suportado** — o binário antigo do Excel não é lido; guarda como `.xlsx` ou `.csv` |

## Limites

- Ficheiro: **10 MB** no máximo.
- Linhas: **20 000** por ficheiro.
- `.xlsx` é verificado antes de abrir: o tamanho descomprimido declarado no ZIP
  não pode exceder **50 MB** (proteção contra zip bombs).
- O POST ao servidor aceita **5 MB** por pedido; o cliente envia automaticamente
  em blocos de **500 linhas**.

## Separador e números

O separador é **detetado uma vez a partir do cabeçalho** — conta-se `;`, `,` e
TAB fora de aspas e usa-se o mais frequente (em empate, `;`). Todas as linhas
são divididas só por esse separador, por isso vírgulas dentro de um campo
(aspas ou não) não partem colunas quando o ficheiro é `;`.

Números no formato português: a vírgula é o separador decimal e o ponto é o
separador de milhares.

| Escrito | Importado |
|---|---|
| `12,50` | `12.5` |
| `1.234,56` | `1234.56` |
| `1.000` | `1000` |
| `89.9` | `89.9` |

Uma célula vazia é simplesmente ignorada (o campo não é alterado). Um valor que
não é número **nunca vira `0`** — passa a erro de linha.

## Erros por linha

Cada linha é validada individualmente (`safeParse`): uma linha inválida não
aborta o lote. O resumo devolve `created`, `updated`, `skipped` e
`errors: [{ row, field, message }]`, onde `row` é a linha da folha (a primeira
linha de dados é a 2, porque a 1 é o cabeçalho). As mensagens são traduzidas —
nunca texto cru do Prisma. No ecrã de importação podes **descarregar um CSV
com os erros** (`row;field;error`).

## Semântica por entidade

### Peças e serviços

- Correspondência por nome **case-insensitive**. Um nome que exista mais de
  uma vez no catálogo gera um erro de conflito — nunca se atualiza um ao
  calhas.
- `category` **só muda se a coluna vier no ficheiro**; valores inválidos são
  erro de linha.
- Alterações de stock geram um `StockMovement` do tipo `ADJUSTMENT` com o
  delta (`novo − antigo`), dentro de uma transação por linha — o livro de
  stock mantém o rasto de quem/quando/porquê.

### Fichas (jobs) — importação histórica

- O cliente é encontrado por **telefone normalizado** (`normalizePhone` +
  `findByNormalizedPhone`, igual ao `customers.service.create`); se não
  existir, é criado.
- A marca é procurada case-insensitive; se não existir, é criada.
- `jobCode` e `ref`/`externalRef` servem para **deduplicar reimportações**:
  uma linha cuja referência já existe é contada como `skipped`, nunca
  duplicada.
- `status`, `createdAt` e `deliveredAt` são opcionais. Importação histórica
  assume `DELIVERED` por defeito. Datas aceitam ISO (`2025-12-01`,
  `2025-12-01T10:30:00Z`) e formato PT (`01/12/2025`).
- Cada ficha importada regista `JOB_CREATED` no audit log (e
  `STATUS_CHANGED → DELIVERED` carimbado em `deliveredAt` quando aplicável, de
  modo a que o export volte a mostrar a data de entrega).

## Exportação

- CSV `;`, UTF-8 com BOM; para Excel é gerado `.xlsx` no cliente com colunas
  numéricas como `Number` real.
- **Proteção contra injeção de fórmulas**: células que comecem por `=`, `+`,
  `-`, `@`, TAB ou CR são prefixadas com `'` — o pré-check público grava texto
  de terceiros na BD, e isso não pode tornar-se fórmulas ao abrir no Excel.
- A exportação é **paginada** (blocos de 1000) em vez de ler 50 000 linhas de
  uma vez.

## Auditoria

Cada operação grava `DATA_EXPORTED` / `DATA_IMPORTED` no audit log com apenas
`{ entity, rows }` — sem nomes, telefones, emails ou conteúdo das linhas
(denylist do #81).

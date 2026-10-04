# Marketplace B2B — OficinaOS (roadmap, pós-beta)

> **Estado**: desenho aprovado, **não implementado**. Prioridade: depois das
> primeiras lojas beta reais — um marketplace sem liquidez não vale nada.
> Validar a procura com as lojas beta (ou um grupo WhatsApp moderado pelo
> operador) antes de escrever código.

## O que é

Plataforma de classificados **só para profissionais**: lojas de reparação e
centros técnicos anunciam e compram entre si:

- Peças retiradas / OEM usadas (ecrãs, baterias, boards)
- Telemóveis usados e retomas
- Equipamento novo e excedente de stock
- Lotes ("lote de 20 baterias", "lote de ecrãs mistos")

## Modelo de negócio — classificados + contacto (decisão tomada)

O anúncio mostra o contacto da loja vendedora; **o negócio fecha-se fora da
plataforma** (transferência entre empresas, envio por CTT, levantamento).
A plataforma **nunca toca em dinheiro**:

- Sem escrow, sem PSP, sem disputas de pagamento — zero carga regulatória
- Receita = subscrição Pro, não fee por transação
- Vantagem do modelo: como a loja já pagou o módulo, não há incentivo para
  "fugir da plataforma" para evitar comissões — o contrário de marketplaces
  por comissão

**Nunca implementar pagamentos/escrow dentro da plataforma** sem uma decisão
explícita — é outro negócio (fintech), não um módulo.

## O diferenciador: diagnóstico verificado

O que distingue isto de um grupo de WhatsApp: o **relatório do OficinaDiag
anexado ao anúncio** é o certificado de condição.

Fluxo: scan no diag → "Anunciar no marketplace" → rascunho de listagem na
cloud → técnico mete preço + fotos → anúncio publicado com badge
"verificado por OficinaDiag" mostrando:

- Saúde real da bateria (%, ciclos)
- Checklist funcional (liga, ecrã, toque, câmaras, áudio)
- Modelo confirmado (resolução de nomes, não o codename)

### Regra de privacidade — OBRIGATÓRIA

O `DeviceReport` contém **serial/IMEI — nunca vai na listagem pública**
(vetor de fraude e clonagem). O anúncio mostra só: modelo, saúde da
bateria, checklist, SO. O serial valida-se entre as duas lojas na
concretização do negócio. Ideal: relatório guardado na cloud referenciado
por hash, para o comprador saber que não foi adulterado.

## Porque encaixa na arquitetura

É um módulo Pro normal — zero complexidade nova:

- Precisa de alcance loja↔loja → vive na **Cloud** (repo privado), não na app
- Vendedores são lojas **verificadas** (conta + pairing já existem)
- Entitlement `market` (ou `b2b`) — o admin da cloud já ativa/revoga
- App: página gated pelo entitlement, como o portal hoje

## Fases

### Fase 0 — validação (antes de qualquer código)

Com 3–5 lojas beta: perguntar diretamente se negoceiam entre si, o quê e
como. Opcional: grupo WhatsApp moderado pelo operador para provar procura.

### Fase 1 — MVP "classificados" (~1 semana, tudo sobre infra existente)

- **Cloud**: `MarketListing` (tipo: `part | used-device | new-device | lot`,
  título, condição, preço, qtd, fotos, região, `shipsByMail`), CRUD +
  pesquisa, `requireModule("market")`; admin: remover anúncio, suspender loja
- **App**: página Marketplace — pesquisar + criar anúncio a partir de peça
  do stock ou de equipamento ("anunciar esta peça")
- **Diag**: botão "Anunciar" após scan → rascunho com relatório anexado
- Contacto = revelar telefone/WhatsApp/email da loja vendedora

### Fase 2

- Ofertas estruturadas: comprador propõe preço → vendedor aceita → troca de
  contacto
- Alertas de pesquisa gravada ("avisa quando aparecer ecrã iPhone 12 OEM")
- Relatório diag verificado por hash

### Fase 3 — provavelmente nunca

Pagamentos/escrow. Só com parceiro tipo Stripe Connect e se o volume
justificar. Por defeito: **não fazer**.

## Nuance de pricing

Gatear tudo por Pro mata a liquidez no arranque. Opção a avaliar na altura:
**ver/listar grátis, anunciar requer Pro** — qualquer loja entra e vê valor,
mas só lojas Pro vendem. Decide-se quando se construir, com dados das beta.

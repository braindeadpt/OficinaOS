# Balcão IA — WhatsApp com orçamentos e agendamento (roadmap)

> **Estado**: ideia registada, **não aprovada nem implementada**.
> Condição para avançar: tração no core grátis + interesse Pro comprovado
> nas lojas beta. Sem utilizadores free não há funil para o Pro.

## O que é

Evolução do módulo `whatsapp-bot` de "responde o estado" para **balcão de
atendimento automático** no WhatsApp da loja:

- Responder "já está pronto?" — **já existe** (intents determinísticos)
- Orçamento estimado por modelo + avaria ("quanto custa o ecrã de um
  iPhone 13?") — novo
- Marcar entregas/recolhas — novo (não existe conceito de agendamento)
- Estado proativo da reparação — parcial (outbox existe; WhatsApp fora
  da janela de 24h exige templates Meta aprovados — bloqueado na
  Business Verification)
- Cobrança: €/loja/mês (modelo Pro normal — mas billing real é projeto
  à parte; hoje os grants são manuais)

## O que falta construir (gaps honestos)

1. **Fonte de verdade para estimativas** — `RepairCatalog` tem preço por
   tipo de reparação, não por modelo. Opções: matriz modelo×reparação na
   loja → fallback range do `market-prices` → sempre com disclaimer
   "estimativa, valor final após diagnóstico". LLM nunca inventa preços.
2. **Agendamento** — schema novo (Booking/Appointment) + UI + fluxo no
   bot. É a peça maior.
3. **Camada LLM** — hoje o bot é determinístico (keywords). Proposta:
   **híbrido** — intents conhecidos respondem como hoje (rápido, grátis,
   zero risco); texto livre não reconhecido → LLM com tools de leitura
   (estado do job, catálogo) e instrução estrita de nunca inventar
   valores; handoff para humano mantém-se.
4. **Privacidade** — texto do cliente passaria por LLM terceiro (cloud
   chama, como `ai-reports`); documentar no privacy doc do módulo.
5. **Templates Meta** — notificações proativas precisam de templates
   aprovados (pendente Business Verification). SMS já faz proativo.

## Decisões pendentes (quando se construir)

- Módulo novo (`ai-counter`) ou evolução do `whatsapp-bot`? Afeta
  entitlements e preço.
- "Balcão IA" é nome de marketing bom — mas manter o ID do módulo neutro.
- Billing real: Stripe, faturas via InvoiceXpress (já integrado) ou
  débito? Projeto separado, fora do âmbito do bot.

## Fase sugerida (se/quando houver tração)

1. Intents novos determinísticos no bot atual: estimativa via catálogo +
   benchmark, resposta com preços a não-clientes — testável com as lojas
   beta assim que ativarem.
2. LLM fallback (cloud-side, padrão `ai-reports`).
3. Agendamento de entregas.

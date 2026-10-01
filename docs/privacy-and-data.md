# Privacidade e dados (RGPD)

Guia simples sobre onde ficam os dados quando usas o OficinaOS — pensado
para donos de loja e para quem trata da conformidade RGPD.

## A regra de ouro

**O OficinaOS corre no computador da tua loja.** Clientes, reparações,
stock, caixa e fotos ficam nesse computador — não existem servidores
nossos a receber nada.

Na prática, para o RGPD isto significa:

- A loja é a **responsável pelo tratamento** dos dados (como sempre foi,
  mesmo com papel e caneta)
- Nós (quem faz o OficinaOS) **não somos subcontratantes** — nunca vemos
  nem tocamos nos teus dados, por isso não é preciso nenhum acordo de
  processamento (Art. 28) connosco
- **Não há transferências internacionais de dados** para o nosso lado,
  porque não há lado nosso — não há cloud, não há conta nossa, não há
  telemetria

Isto não te dispensa das obrigações normais (registar o tratamento,
proteger o acesso, responder a pedidos de clientes), mas simplifica-as
bastante: o tratamento acontece todo dentro da tua loja, no teu equipamento.

## O que pode sair da loja — só se ligares

Algumas funcionalidades opcionais falam com serviços externos. Cada uma
é escolha tua e pode ficar desligada. Esta tabela serve para o teu
registo de atividades de tratamento (Art. 30):

| Funcionalidade | Quem recebe | O que sai | Como desligar |
|---|---|---|---|
| Acesso remoto (Cloudflare Tunnel) | Cloudflare, Inc. (EUA, com cláusulas UE) | O tráfego que passa pelo túnel: páginas e dados consultados por quem usa o acesso remoto ou os links públicos | Não ligues o profile `tunnel` |
| Links públicos ao cliente (tracking, orçamentos, recibos, pré-check) | Cloudflare, Inc. | Os dados mostrados nessas páginas públicas | Sem túnel, os links só funcionam dentro da loja |
| Notificações WhatsApp | Meta (WhatsApp Business) | O número de telefone do cliente e o texto da notificação (estado da reparação) | Definições → WhatsApp → desligar |
| Analista IA | O fornecedor que configurares (ex.: OpenAI) | O conteúdo das perguntas que fizeres à IA | Definições → IA → desligar (vem desligado) |
| Reviews Google | Google | Apenas o link de review — nenhum dado do cliente sai, o cliente abre a página dele | Definições → Reviews → desligar |

## Chamadas técnicas (sempre ativas, sem dados de clientes)

Há três ligações à internet que a app faz por si, sem dados pessoais —
ficam aqui para transparência total:

| Chamada | Para onde vai | O que sai | Nota |
|---|---|---|---|
| Fontes (letra da interface) | Google Fonts | O IP de quem abre a página — a Google vê que "alguém abriu uma página", nada mais | Acontece em cada abertura de página, staff e cliente |
| Verificação de nova versão | GitHub | O IP do PC da loja ao consultar a versão mais recente | Só serve para avisar que há update |
| Reportar problema | GitHub | O texto que escreveres no relatório + página atual/versão | Só quando carregas em "Reportar" — nunca automático |

## O que nunca sai

Independentemente das opções ligadas:

- Base de dados completa, fotos de reparações, relatórios financeiros —
  ficam no disco do PC da loja
- Palavras-passe e sessões dos funcionários
- Documentos e anexos guardados na app

## Recomendações práticas para a loja

1. **O PC-servidor é o cofre.** Ativa a password do Windows, mantém o PC
   atualizado, e usa o backup integrado (Definições → Backups).
2. **Contas individuais.** Cada funcionário com a sua conta — não
   partilhem passwords. Os perfis (dono, técnico, balcão) já limitam o
   que cada um vê.
3. **Consentimento WhatsApp.** A app só envia WhatsApp a clientes que
   deram consentimento — guarda esse consentimento na ficha do cliente.
4. **Pedidos do cliente (RGPD).** Se um cliente pedir os seus dados ou o
   apagamento, consegues exportar/editar na ficha do cliente. Fala com o
   teu contabilista ou consultor RGPD para o procedimento formal.
5. **Se ligares o acesso remoto**, indica a Cloudflare como
   subcontratante no teu registo (tabela acima já tem o que precisas).

## Nota técnica

Este documento descreve o comportamento do código tal como está no
repositório — podes verificar tu mesmo: não há chamadas de rede "escondidas"
na app; todas as ligações externas correspondem às funcionalidades da
tabela. Para detalhes de segurança (headers, cookies, rate limits) vê
`server/plugins/security.ts`.

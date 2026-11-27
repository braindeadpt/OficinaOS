# OficinaOS v1.0.23 — notas da versão (rascunho)

## Português

### Livro de Ponto

- **Exportação para a ACT.** O livro de ponto passa a exportar os registos no formato exigido para a Autoridade para as Condições do Trabalho — a loja deixa de montar ficheiros à mão se for inspecionada.
- **Folha de informação aos trabalhadores.** A app gera a folha que explica ao trabalhador que dados o livro de ponto recolhe e durante quanto tempo, com registo de entrega — a obrigação de informação fica documentada.
- **As fotografias deixam de ser guardadas.** Os registos externos feitos com fotografia guardam apenas a nota «foto enviada às HH:MM» — a imagem nunca fica na base de dados. Menos dados pessoais, menos risco para a loja.
- **Localização só quando é preciso.** Quem regista com o QR do ecrã da loja, dentro da rede da loja, já não precisa de partilhar a localização. A localização só é pedida quando não há outra prova de presença.
- **Modo só-ponto.** Um computador ou tablet pode ficar dedicado ao livro de ponto, com textos neutros e sem acesso ao resto da gestão.
- **Backups alojados, cifrados e verificados.** As cópias de segurança do livro de ponto são verificadas automaticamente — a loja sabe que o backup abre, antes de precisar dele.
- **Código em todos os registos.** O código do QR passa a valer também para pausa, regresso e saída, não só para a entrada.
- **Imutabilidade reforçada.** Os registos de ponto só podem ser purgados ao fim de 5 anos e por rotinas controladas — reforço do cumprimento do prazo legal.

### MCP (ligação a assistentes de IA)

- **MCP só de leitura, grátis.** A loja pode ligar um assistente de IA aos dados da oficina — clientes, reparações, vendas — em modo só de leitura, sem custo. Os dados pessoais saem mascarados.
- **Tokens pessoais revogáveis.** Cada pessoa tem o seu token e pode revogá-lo a qualquer momento — partilhar uma password deixa de fazer sentido.

### Assinaturas

- **Termos legais resolvidos no servidor.** O texto que o cliente assina é o da loja no momento exato da assinatura e fica guardado com ela — nem o cliente nem a aplicação o podem trocar. Uma assinatura antiga continua ligada à versão exata que foi mostrada.
- **Proveniência no recibo.** O recibo indica a versão dos termos assinados e a data em que a loja a editou — em caso de disputa, a loja mostra o que foi apresentado.

### Segurança

- **Correções da auditoria ao MCP.** Várias correções de segurança na ligação MCP, revistas em auditoria.
- **Credenciais do WhatsApp na Cloud.** As credenciais Meta deixam a loja e passam a ser geridas na Cloud, com consentimento explícito — menos um segredo guardado no computador da loja.
- **Correção de vulnerabilidade numa dependência.**

### Outros

- **Bot de atendimento mais fiável.** O assistente deixa de adivinhar reparações ambíguas e o contexto que envia à Cloud fica limitado ao que o cliente pode ver.
- **Documentação em inglês revista**, com capturas de ecrã.

## English

### Time Clock (Livro de Ponto)

- **ACT export.** Time-clock records can now be exported in the format required by the Portuguese labour authority — no more hand-built files if the shop is inspected.
- **Worker information sheet.** The app generates the sheet explaining to each worker what the time clock collects and for how long, with a delivery record — the information duty is documented.
- **Photos are no longer stored.** External check-ins made with a photo keep only the note "photo sent at HH:MM" — the image never reaches the database. Less personal data, less risk for the shop.
- **Location only when needed.** Staff checking in with the shop-screen QR code, on the shop network, no longer need to share their location. Location is only asked when there is no other proof of presence.
- **Time-clock-only mode.** A computer or tablet can be dedicated to the time clock, with neutral texts and no access to the rest of the system.
- **Hosted, encrypted, verified backups.** Time-clock backups are automatically verified — the shop knows the backup opens before it needs it.
- **Code for every event.** The QR code now works for breaks, returns and clock-outs too, not just clock-ins.
- **Stronger immutability.** Time-clock entries can only be purged after 5 years and only by controlled routines — reinforcing the legal retention period.

### MCP (AI assistant connection)

- **Read-only MCP, free of charge.** The shop can connect an AI assistant to its data — customers, repairs, sales — in read-only mode, at no cost. Personal data comes out masked.
- **Personal, revocable tokens.** Each person has their own token and can revoke it at any time — sharing a password no longer makes sense.

### Signatures

- **Legal terms resolved on the server.** The text the customer signs is the shop's text at the exact moment of signature and is stored with it — neither the customer nor the app can swap it. An old signature stays linked to the exact version that was shown.
- **Provenance on the receipt.** The receipt shows the version of the signed terms and the date the shop last edited them — in a dispute, the shop can show what was presented.

### Security

- **MCP audit fixes.** Several security fixes to the MCP connection, reviewed in audit.
- **WhatsApp credentials moved to the Cloud.** Meta credentials leave the shop and are managed in the Cloud, with explicit consent — one less secret stored on the shop computer.
- **Dependency vulnerability fix.**

### Other

- **More reliable service bot.** The assistant no longer guesses ambiguous repairs, and the context it sends to the Cloud is limited to what the customer can see.
- **Revised English documentation**, with screenshots.

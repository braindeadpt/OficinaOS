# OficinaOS v1.0.23 — notas da versão

## Português

### Livro de Ponto

- **Exportação para a ACT.** O livro de ponto passa a exportar os registos no formato exigido para a Autoridade para as Condições de Trabalho — a loja deixa de montar ficheiros à mão se for inspecionada. Cada registo exportado indica como foi provado (no ecrã da loja, por fotografia ou à distância).
- **Comando REGISTOS.** Se um trabalhador pedir os seus dados, a app exporta os registos dele prontos a entregar — o pedido fica respondido em minutos, com registo do acesso.
- **Folha de informação aos trabalhadores.** A app gera a folha que explica ao trabalhador que dados o livro de ponto recolhe e durante quanto tempo, com registo de entrega — a obrigação de informação fica documentada.
- **As fotografias deixam de ser guardadas.** Os registos externos feitos com fotografia guardam apenas a nota «foto enviada às HH:MM» — a imagem nunca fica na base de dados. Menos dados pessoais, menos risco para a loja.
- **Localização só quando é preciso.** Quem regista com o QR do ecrã da loja, dentro da rede da loja, já não precisa de partilhar a localização. A localização só é pedida quando não há outra prova de presença.
- **Teletrabalho sem localização.** Nos dias marcados como teletrabalho, o registo não pede localização nenhuma — a loja marca os dias e o trabalhador regista normalmente.
- **Modo só-ponto.** Um computador ou tablet pode ficar dedicado ao livro de ponto, com textos neutros e sem acesso ao resto da gestão.
- **Backups alojados e cifrados, com teste de restauro.** As cópias do livro de ponto saem cifradas e assinadas, e há um teste de restauro automático (mensal, configurável numa máquina separada) que restaura a cópia mais recente e confirma que abre — a loja deixa de descobrir um backup estragado só quando precisa dele.
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
- **Documentos na língua do país da loja.** Os documentos que a app gera passam a seguir a língua do país configurado na loja, e os valores monetários saem com a formatação certa em todos os ecrãs e impressões.
- **Telefones arrumados.** Os números de telefone novos são guardados sempre da mesma forma (com indicativo do país), o que acaba com a maioria dos clientes duplicados. Para os que já existem, há um relatório de «possíveis duplicados» onde a loja junta fichas em segurança — cada junção fica registada.
- **Correções no portal do cliente.** Pedidos inválidos passam a receber uma resposta clara em vez de um «OK» falso.
- **Documentação em inglês revista**, com capturas de ecrã.

### Antes de atualizar

Esta versão precisa da Cloud atualizada para tudo funcionar — a OficinaOS Cloud já está na versão certa, não tens de fazer nada.

## English

### Time Clock (Livro de Ponto)

- **ACT export.** Time-clock records can now be exported in the format required by the Portuguese labour authority — no more hand-built files if the shop is inspected. Every exported entry shows how it was proven (shop screen, photo or remote).
- **REGISTOS command.** If a worker asks for their data, the app exports their records ready to hand over — the request is answered in minutes, with an access record.
- **Worker information sheet.** The app generates the sheet explaining to each worker what the time clock collects and for how long, with a delivery record — the information duty is documented.
- **Photos are no longer stored.** External check-ins made with a photo keep only the note "photo sent at HH:MM" — the image never reaches the database. Less personal data, less risk for the shop.
- **Location only when needed.** Staff checking in with the shop-screen QR code, on the shop network, no longer need to share their location. Location is only asked when there is no other proof of presence.
- **Remote work without location.** On days marked as remote work, clocking never asks for any location — the shop marks the days and the worker clocks in as usual.
- **Time-clock-only mode.** A computer or tablet can be dedicated to the time clock, with neutral texts and no access to the rest of the system.
- **Hosted, encrypted backups with restore testing.** Time-clock backups are encrypted and signed, and an automated restore test (monthly, configurable on a separate machine) restores the latest copy and confirms it opens — the shop no longer finds out a backup is broken only when it needs it.
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
- **Documents in the language of the shop's country.** Documents generated by the app now follow the language of the country configured in the shop, and money amounts use the right formatting everywhere, on screen and in print.
- **Tidy phone numbers.** New phone numbers are always stored in the same way (with the country code), which ends most duplicate customers. For the ones already there, there is a "possible duplicates" report where the shop safely merges records — every merge is recorded.
- **Customer portal fixes.** Invalid requests now get a clear answer instead of a false "OK".
- **Revised English documentation**, with screenshots.

### Before updating

This version needs the Cloud up to date for everything to work — the OficinaOS Cloud is already on the right version, there is nothing you need to do.

# Fluxo de tarefas e RMAs

## Implementado nesta branch

- Tarefas no painel do proprietário, técnico e balcão, e integradas nas fichas de reparações.
- Tarefas associadas a reparações, RMAs, pedidos de entrada, devoluções, encomendas, retomas, fornecedores ou clientes; continuam a existir tarefas gerais.
- Em listas, expandir **Tarefas e estado de acompanhamento** no registo pretendido. Em reparações, clientes e devoluções, a secção começa expandida.
- Nova área **Encomendas**: descrição, fornecedor, referência e notas; criação e edição, tarefas e estado de acompanhamento. No fornecedor existe uma ligação para as respetivas encomendas. Esta área ainda não efetua receções de stock nem contabilização de faturas.
- Estados de acompanhamento por módulo: o administrador pode criar, renomear, desativar e reativar estados; cada ficha permite selecionar um estado. Desativar preserva as associações existentes.
- Os estados de acompanhamento complementam os estados operacionais originais. Não substituem as transições que movimentam stock, pagamentos, garantias ou resolução de RMAs. Os nomes dos estados operacionais originais continuam fixos nesta versão.
- Regras automáticas para estados de acompanhamento de qualquer módulo, além das regras existentes por estado operacional de reparação. A atribuição de um estado e as tarefas geradas são gravadas na mesma transação. O arranque e a verificação periódica também reconciliam os registos já nesse estado.
- Uma regra cria uma tarefa por registo, mesmo se voltar ao mesmo estado. Repetir a atribuição ou reiniciar a aplicação não duplica tarefas. A tarefa seguinte conserva a associação ao módulo e ao registo.
- O painel respeita as permissões de cada módulo e o âmbito individual das devoluções. Além dos editores do módulo, o responsável atribuído pode concluir as próprias tarefas, desde que mantenha acesso ao registo.
- IA: predefinições OpenAI, Google Gemini e Mistral AI, com modelo editável e opção de outro serviço compatível. É necessário configurar uma chave própria. Ao mudar o servidor do fornecedor sem nova chave, a chave anterior é removida e a IA fica desativada.
- O Gemini usa a API compatível com OpenAI, com preservação das assinaturas das chamadas de ferramentas. O modelo inicial é `gemini-3.5-flash-lite`, editável nas definições. O nível gratuito está sujeito a modelos, contas, quotas e condições da Google; esta aplicação não garante disponibilidade ou gratuidade. Ligações reais aos fornecedores precisam de validação com a chave da loja.
- Responsável (técnico ou proprietário ativo), prioridade, notas, início agendado e prazo.
- Ao concluir uma tarefa, criar a tarefa seguinte indicada, imediatamente ou após um número de horas.
- A conclusão é transacional: repetir o pedido ou clicar duas vezes não cria duas tarefas seguintes.
- Regras por estado de reparação, geridas apenas por quem tem permissão de editar definições.
- As regras são verificadas a cada 30 segundos e no arranque. Abrangem reparações já no estado escolhido e transições registadas depois da criação da regra, mesmo que a reparação tenha entretanto mudado novamente.
- Cada combinação regra/reparação cria uma única tarefa. Desativar a regra impede novas criações, mas mantém o histórico das tarefas existentes.
- Fotografias novas classificadas como Entrada, Reparação ou Finalização. As fotografias antigas mantêm a classificação anterior.
- RMAs associados a uma reparação pelo número, com ligação de navegação em ambos os sentidos.
- Correção do formulário RMA: pedidos independentes impedem que uma falha na lista de peças oculte os fornecedores; o limite pedido à API passa a ser válido.
- Proprietários ativos disponíveis na seleção de técnicos, mantendo as permissões de proprietário.

## Exemplo

Em **Tarefas**, criar uma regra para **Aguardar peças** com título **Encomendar peça** e tarefa seguinte **Aguardar receção da peça**. Escolher o responsável e o atraso pretendido.

A tarefa seguinte fica agendada para o momento da conclusão mais o atraso. Não é uma confirmação de encomenda ou de chegada real: essas ações são confirmadas pela equipa. A regra não altera o estado da reparação.

É possível editar tarefas pendentes na tabela: título, responsável, prioridade, notas, datas e configuração da tarefa seguinte. A associação ao registo permanece fixa. Tarefas concluídas não podem ser alteradas; a gravação verifica também se ocorreu uma conclusão concorrente.

As regras automáticas podem ser editadas. O formulário obriga a escolher a secção e apresenta apenas estados dessa secção; os estados operacionais de reparação aparecem apenas em Reparações. Alterar uma regra aplica-se às futuras gerações e não reescreve tarefas já criadas. Cada regra continua a gerar uma tarefa por registo.

Esta versão permite definir uma tarefa seguinte por tarefa criada. Não contém ainda um editor de cadeias arbitrárias ou sincronização com calendários externos.

## Instalação e validação

É necessário aplicar a migração Prisma adicionada antes de arrancar a aplicação. A configuração Node.js encontra-se nesta branch por herdar `inove/node-compat`.

Antes de instalar numa loja: backup da base de dados, uploads e `.env`; validar a migração numa cópia da base de dados; compilar e testar; só depois recriar o contentor da aplicação. Não correr `db:seed` numa atualização para tentar migrar dados.

As tarefas e as suas notas são internas. Não são devolvidas nos endpoints públicos de acompanhamento de reparações.

## Restante âmbito solicitado — ainda por implementar

1. Documentos carregados uma vez e associados a várias reparações, tarefas, peças, faturas e RMAs. Visibilidade por associação, interna por defeito; faturas de fornecedor partilhadas permanecem internas. Remover uma associação não elimina as restantes.
2. Completar o histórico por fornecedor com receções, peças, custos, faturas, notas de crédito, pagamentos e garantias. As encomendas básicas já estão ligadas ao fornecedor.
3. Documentos Diagnosticamente PC/Mobile com fase Antes/Depois e partilha controlada no acompanhamento do cliente. Upload manual primeiro; envio automático requer integração nos dois programas e autenticação própria, sem publicar dados privados.
4. Fotografias: legendas, alteração da fase após upload, agrupamento por fase e visibilidade para o cliente, verificada no servidor.
5. Agenda interna e marcações públicas, sincronização Google Calendar, gestão de conflitos, cancelamentos e proteção dos eventos privados. Credenciais OAuth e calendário de destino ainda por configurar.
6. Substituição dos estados operacionais nativos por um fluxo inteiramente configurável; a implementação atual disponibiliza estados de acompanhamento adicionais e mantém o fluxo operacional original.
7. Melhorias dos importadores: mapeamento de colunas, pré-visualização, referências de origem, datas/estados/valores, idempotência, XLS antigo e movimentos de stock. Os ficheiros de exemplo de origem ainda não foram fornecidos.
8. Etiqueta Brother DK-22205: equipamento, cliente, contacto e entrada, além da referência/QR. A correspondência do rolo de 62 mm também depende do controlador instalado no PC; precisa de teste físico.

Esta lista distingue requisitos de funcionalidades já existentes. As integrações e os restantes módulos não devem ser anunciados como concluídos com esta branch.


## Atualizar a instância de testes

A migração `20261106000000_universal_workflow` acrescenta tabelas e colunas, preservando a ligação das tarefas antigas às reparações. Não altera a migração já aplicada anteriormente.

Na pasta de testes, efetuar backup antes de atualizar. Depois de obter esta branch, reconstruir e recriar apenas a aplicação com o projeto e ficheiro Compose da instância de testes. O comando de arranque da imagem Node aplica `prisma migrate deploy`.

Para configurar um estado e uma regra: abrir um registo, expandir a secção de tarefas, criar o estado como administrador e, na página **Tarefas**, criar uma regra escolhendo esse módulo/estado na lista de gatilhos. As regras e notas continuam internas, sem exposição no portal público do cliente.

Documentação dos fornecedores: [Gemini/OpenAI](https://ai.google.dev/gemini-api/docs/openai), [quotas e preços Gemini](https://ai.google.dev/gemini-api/docs/pricing), [Mistral/OpenAI](https://docs.mistral.ai/resources/migration-guides).


## Tabelas e gestão dos estados

As tarefas aparecem em tabela no painel, nas fichas e na página de Tarefas, com secção/referência, responsável, prioridade, datas, estado e ações. **Encomendas** ocupa a terceira posição no menu, depois de Painel e Reparações, para utilizadores com acesso ao catálogo.

A gestão de estados está disponível no topo das secções de Reparações, RMAs, Pedidos, Devoluções, Encomendas, Retomas, Fornecedores e Clientes, mesmo quando ainda não existem registos. A página Tarefas permite gerir os estados de todas essas secções. Os estados operacionais nativos mantêm-se; os estados configuráveis são de acompanhamento.

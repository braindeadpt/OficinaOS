# Fluxo de tarefas e RMAs

## Implementado nesta branch

- Tarefas gerais ou associadas à referência de uma reparação.
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

Esta primeira versão permite definir uma tarefa seguinte por tarefa criada. Não contém ainda um editor de cadeias arbitrárias, edição de tarefas existentes ou sincronização com calendários externos.

## Instalação e validação

É necessário aplicar a migração Prisma adicionada antes de arrancar a aplicação. A configuração Node.js encontra-se nesta branch por herdar `inove/node-compat`.

Antes de instalar numa loja: backup da base de dados, uploads e `.env`; validar a migração numa cópia da base de dados; compilar e testar; só depois recriar o contentor da aplicação. Não correr `db:seed` numa atualização para tentar migrar dados.

As tarefas e as suas notas são internas. Não são devolvidas nos endpoints públicos de acompanhamento de reparações.

## Restante âmbito solicitado — ainda por implementar

1. Documentos carregados uma vez e associados a várias reparações, tarefas, peças, faturas e RMAs. Visibilidade por associação, interna por defeito; faturas de fornecedor partilhadas permanecem internas. Remover uma associação não elimina as restantes.
2. Histórico por fornecedor: encomendas, receções, peças, custos, faturas, notas de crédito, pagamentos, garantias e RMAs.
3. Documentos Diagnosticamente PC/Mobile com fase Antes/Depois e partilha controlada no acompanhamento do cliente. Upload manual primeiro; envio automático requer integração nos dois programas e autenticação própria, sem publicar dados privados.
4. Fotografias: legendas, alteração da fase após upload, agrupamento por fase e visibilidade para o cliente, verificada no servidor.
5. Agenda interna e marcações públicas, sincronização Google Calendar, gestão de conflitos, cancelamentos e proteção dos eventos privados. Credenciais OAuth e calendário de destino ainda por configurar.
6. Estados personalizados com correspondência às fases internas para preservar regras, relatórios e histórico.
7. Melhorias dos importadores: mapeamento de colunas, pré-visualização, referências de origem, datas/estados/valores, idempotência, XLS antigo e movimentos de stock. Os ficheiros de exemplo de origem ainda não foram fornecidos.
8. Etiqueta Brother DK-22205: equipamento, cliente, contacto e entrada, além da referência/QR. A correspondência do rolo de 62 mm também depende do controlador instalado no PC; precisa de teste físico.

Esta lista distingue requisitos de funcionalidades já existentes. As integrações e os restantes módulos não devem ser anunciados como concluídos com esta branch.

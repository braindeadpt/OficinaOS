import subprocess, sys

C = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
replies = {
# docs do site → mentor
"PRRT_kwDOUwilEs68jxDM": """Fica a cargo do mentor, num PR separado no repositório do site — tal como ficou combinado para a exportação ACT na #208.""",
# datas futuras
"PRRT_kwDOUwilEs68jxEI": f"""Corrigido em {C}.

`upsertPontoInfoDelivery` rejeita agora datas de entrega no futuro — a comparação faz-se no dia civil **da loja** (o fuso efetivo vem do `dashboardScope` da rota), não no dia do servidor/dispositivo. Uma entrega "amanhã" deixa de fazer o trabalhador desaparecer do aviso antes de a folha lhe ter chegado.

Teste incluído: data de amanhã é recusada com `VALIDATION_ERROR` e o upsert nunca é chamado. A validação fica no serviço (não no schema zod) porque "hoje" depende do fuso da loja — o schema continua a garantir o formato.""",
# migração
"PRRT_kwDOUwilEs68jxFe": f"""Corrigido em {C}.

A migração fica alinhada com o que o Prisma gera para este modelo:
- FK com `ON DELETE CASCADE ON UPDATE CASCADE` (o default do Prisma para `onUpdate` é CASCADE);
- `updatedAt TIMESTAMPTZ NOT NULL` **sem** `DEFAULT` — o `@updatedAt` é gerido pelo cliente Prisma, não pela base de dados.

Confirmei contra as migrações existentes do repo (`20260413143939_init` etc.), que seguem exatamente este padrão.""",
# data do dispositivo
"PRRT_kwDOUwilEs68jxGi": f"""Corrigido em {C}.

O formulário passa a pré-preencher a data no fuso **da loja** (`tz` da store do ponto, que vem do `/ponto/status`) via `Intl.DateTimeFormat` com `timeZone` — o dia do dispositivo só serve de fallback se o fuso ainda não tiver carregado. Guardar sem editar grava agora o dia civil certo.""",
# impressão em lote vazia
"PRRT_kwDOUwilEs68jxHg": f"""Corrigido em {C}.

Sem trabalhadores com o ponto ativo, o botão «Imprimir todas» já não navega para a folha — mostra a mensagem "Não há trabalhadores com o ponto ativo" (PT/EN/FR/ES) junto ao botão. A folha genérica em branco deixa de ser gerada nesse cenário.""",
# refresh
"PRRT_kwDOUwilEs68jxIW": f"""Corrigido em {C}.

Depois de guardar a ficha do trabalhador na Equipa, é emitido o evento `ponto-info-deliveries-changed` — o mesmo que o registo de entrega já emitia. O aviso do painel e a lista de folhas atualizam sem recarregar nem reabrir o separador.""",
# dependência do #207
"PRRT_kwDOUwilEs68jxJb": """Confirmado: a frase só é verdade depois da #207 entrar. A #207 já está corrigida (as fotografias nunca são descarregadas nem guardadas — nem na app, nem na Cloud, nem em backups do atualizador) e a ordem de merge é: **#207 primeiro, depois #208 e só então esta #214**. A folha não deve ser distribuída antes disso — fica assinalado na descrição do PR.""",
# localização vs rede
"PRRT_kwDOUwilEs68jxKa": f"""Corrigido em {C} — o texto passa a descrever o que o código faz HOJE.

**A ordem real no código**: depois de cada comando de picagem, o fluxo pede SEMPRE a localização de imediato (`stage: "location"`, sem opção de saltar), antes de qualquer avaliação da prova de rede — a rede/QR só entra depois, na validação. Ou seja, ao contrário do que a folha dizia, a localização não é um fallback da prova de rede: é pedida em todas as picagens.

O novo texto (PT/EN/FR/ES) diz apenas: "No momento de cada picagem é pedida a localização atual. A localização nunca é contínua e não há seguimento nem vigilância." — verdadeiro para o fluxo atual, sem prometer uma ordem que o código não cumpre.

Nota para o dono: o produto pede localização mais vezes do que o estritamente necessário (a especificação original era rede primeiro, localização só se falhar). Isso é um tema de privacidade/produto a tratar à parte, fora deste PR.""",
# NIF hardcoded
"PRRT_kwDOUwilEs68jxLL": f"""Corrigido em {C}.

O cabeçalho usa agora `docT("shop_tax_id")` — a chave de tradução existente, resolvida pelo tradutor fixado em PT-PT do documento (exatamente a abordagem sugerida na revisão).""",
}

fail = False
for tid, body in replies.items():
    r = subprocess.run([
        "gh", "api", "graphql",
        "-f", "query=mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { id } } }",
        "-f", f"id={tid}", "-f", f"body={body}",
    ], capture_output=True, text=True)
    ok1 = '"addPullRequestReviewThreadReply"' in r.stdout
    r2 = subprocess.run([
        "gh", "api", "graphql",
        "-f", "query=mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }",
        "-f", f"id={tid}",
    ], capture_output=True, text=True)
    ok2 = '"isResolved":true' in r2.stdout.replace(" ", "").replace("\n", "")
    print(tid[-6:], "reply:", "OK" if ok1 else "FAIL", "| resolved:", "OK" if ok2 else "FAIL")
    if not (ok1 and ok2):
        fail = True
        print("  stderr:", r.stderr[:150], r2.stderr[:150])
sys.exit(1 if fail else 0)

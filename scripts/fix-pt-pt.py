# -*- coding: utf-8 -*-
"""Normaliza pt.json para Português Europeu (pt-PT).
Aplica correções sistemáticas de pt-BR → pt-PT + overrides por key."""
import json, re, io, sys

PATH = "src/i18n/locales/pt.json"
d = json.load(open(PATH, encoding="utf-8"))

# ── 1. Substituições ordenadas (frase primeiro, palavra depois) ──────────
SUBS = [
    # gender agreement antes do swap reparo→reparação
    ("o seu reparo", "a sua reparação"), ("O seu reparo", "A sua reparação"),
    ("este reparo", "esta reparação"), ("Este reparo", "Esta reparação"),
    ("do reparo", "da reparação"), ("Do reparo", "Da reparação"),
    ("no reparo", "na reparação"), ("num reparo", "numa reparação"),
    ("um reparo", "uma reparação"), ("Um reparo", "Uma reparação"),
    ("nenhum reparo", "nenhuma reparação"), ("Nenhum reparo", "Nenhuma reparação"),
    ("o reparo", "a reparação"), ("O reparo", "A reparação"),
    ("reparo ativo", "reparação ativa"), ("reparo listado", "reparação listada"),
    ("reparo encontrado", "reparação encontrada"), ("reparo adicionado", "reparação adicionada"),
    ("reparo criado", "reparação criada"), ("reparo concluído", "reparação concluída"),
    ("reparo suspenso", "reparação suspensa"),
    ("reparos", "reparações"), ("Reparos", "Reparações"),
    ("reparo", "reparação"), ("Reparo", "Reparação"),

    # parte → peça (componente)
    ("partes", "peças"), ("Partes", "Peças"),
    ("parte", "peça"), ("Parte", "Peça"),

    # gerúndio BR → "a" + infinitivo PT-PT
    ("Analisando", "A analisar"), ("analisando", "a analisar"),
    ("Inspecionando", "A inspecionar"), ("Consultando", "A consultar"),
    ("Salvando", "A guardar"), ("salvando", "a guardar"),
    ("Testando", "A testar"), ("testando", "a testar"),
    ("Mudando", "A alterar"), ("mudando", "a alterar"),
    ("Enviando", "A enviar"), ("enviando", "a enviar"),
    ("Criando", "A criar"), ("criando", "a criar"),
    ("Aguardando", "A aguardar"), ("aguardando", "a aguardar"),
    ("Esperando", "A aguardar"), ("esperando", "a aguardar"),
    ("Carregando", "A carregar"), ("carregando", "a carregar"),
    ("Adicionando", "A adicionar"), ("adicionando", "a adicionar"),
    ("Mostrando", "A mostrar"), ("mostrando", "a mostrar"),
    ("retornando", "de regresso"),
    ("Atualizando", "A atualizar"), ("atualizando", "a atualizar"),
    ("Processando", "A processar"), ("Removendo", "A remover"),
    ("Verificando", "A verificar"), ("Conectando", "A ligar"),
    ("Iniciando", "A iniciar"), ("Finalizando", "A finalizar"),
    ("Imprimindo", "A imprimir"), ("Exportando", "A exportar"),
    ("Sincronizando", "A sincronizar"), ("Aplicando", "A aplicar"),
    ("Confirmando", "A confirmar"), ("Cancelando", "A cancelar"),
    ("Editando", "A editar"), ("Abandonando", "A abandonar"),
    ("Buscando", "A procurar"), ("Pesquisando", "A pesquisar"),

    # senha → palavra-passe
    ("senhas", "palavras-passe"), ("Senhas", "Palavras-passe"),
    ("senha", "palavra-passe"), ("Senha", "Palavra-passe"),

    # e-mail → email (AO90)
    ("e-mail", "email"), ("E-mail", "Email"),

    # usuário → utilizador
    ("usuários", "utilizadores"), ("Usuários", "Utilizadores"),
    ("usuário", "utilizador"), ("Usuário", "Utilizador"),

    # estoque → stock
    ("estoque", "stock"), ("Estoque", "Stock"),

    # configurações → definições (não mexe em Configuração/Configurar)
    ("Configurações", "Definições"), ("configurações", "definições"),

    # login → sessão
    ("fazer login", "iniciar sessão"), ("Fazer login", "Iniciar sessão"),
    ("Fazendo login", "A iniciar sessão"), ("fazendo login", "a iniciar sessão"),
    ("Faça login", "Inicie sessão"), ("faça login", "inicie sessão"),
    ("falha no login", "falha no início de sessão"),
    ("tentativas de login", "tentativas de início de sessão"),
    ("Hora de login", "Hora de início de sessão"),
    ("página de login", "página de início de sessão"),
    ("próximo login", "próximo início de sessão"),

    # conectado → ligado
    ("Conectado", "Ligado"), ("conectado", "ligado"),
    ("Desconectado", "Desligado"), ("desconectado", "desligado"),
    ("Conexão", "Ligação"), ("conexão", "ligação"),
    ("conectividade", "conetividade"), ("Conectividade", "Conetividade"),

    # excluir/deletar/apagar → eliminar
    ("Excluir", "Eliminar"), ("excluir", "eliminar"),
    ("excluídos", "eliminados"), ("excluídas", "eliminadas"),
    ("excluído", "eliminado"), ("excluído", "eliminado"), ("excluída", "eliminada"),
    ("Deletar", "Eliminar"), ("deletar", "eliminar"),
    ("deletado", "eliminado"), ("deletada", "eliminada"),

    # misc vocab
    ("Câmera", "Câmara"), ("câmera", "câmara"),
    ("em andamento", "em curso"),
    ("não rastreado", "não registado"), ("não rastreada", "não registada"),
    ("Ingestão Rápida", "Registo rápido"),
    ("Ingestão", "Receção"), ("ingestão", "receção"),
    ("Placa de estado de reparação", "Quadro de estado das reparações"),
    ("placa de reparação", "quadro de reparações"),
    ("tente mais tarde", "tente novamente mais tarde"),
    ("Solicite um novo", "Peça um novo"),
    ("O email válido é obrigatório", "É obrigatório um email válido"),
]

# ── 2. Overrides exatos por key ──────────────────────────────────────────
OVERRIDES = {
    "auth_atelier": "A funcionar na perfeição.",
    "front_desk.quick_intake": "Registo rápido",
    "front_desk.no_active_repairs": "Sem reparações ativas no momento",
    "tech_dashboard.my_repair_board": "O meu quadro de reparações",
    "tech_dashboard.kanban_intake": "Receção",
    "status.INTAKE": "Receção",
    "jobStatus.INTAKE": "Receção",
    "auth_intake": "Receção",
    "returns_photos_intake": "Receção (prova do problema)",
    "returns_file_button": "Registar pedido de devolução",
    "reset_password_desc": "Defina uma nova palavra-passe para {{name}}. Terá de a alterar no próximo início de sessão.",
    "add_user_modal_error_email": "É obrigatório um email válido",
    "tracking_on_hold_desc": "A sua reparação está temporariamente suspensa. Isto pode acontecer quando estamos a aguardar informações ou confirmação. Retomaremos o mais breve possível.",
    "ai_agent_tool_get_schema": "A inspecionar o esquema",
    "ai_agent_tool_query_database": "A consultar a base de dados",
    "profile_activity_user_sign_in": "Sessão iniciada",
    "profile_activity_user_sign_out": "Sessão terminada",
    "loading_dashboard": "A carregar o painel...",
}

# regex: "{{var}}m atrás" → "há {{var}}m"  (ordem PT-PT)
RE_ATRAS = re.compile(r"(\{\{\w+\}\})(\w+) atrás")

changed = []
def fix(v):
    if not isinstance(v, str):
        return v
    nv = RE_ATRAS.sub(r"há \1\2", v)
    for old, new in SUBS:
        if old in nv:
            nv = nv.replace(old, new)
    return nv

def walk(o, path=""):
    for k in o:
        p = f"{path}.{k}" if path else k
        if isinstance(o[k], dict):
            walk(o[k], p)
        elif isinstance(o[k], str):
            if p in OVERRIDES:
                if o[k] != OVERRIDES[p]:
                    changed.append(p); o[k] = OVERRIDES[p]
            else:
                nv = fix(o[k])
                if nv != o[k]:
                    changed.append(p); o[k] = nv
walk(d)

json.dump(d, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
open(PATH, "a", encoding="utf-8").write("\n")
print(f"{len(changed)} keys alteradas")

# verificação: sobras de padrões BR
text = json.dumps(d, ensure_ascii=False)
left = {}
for name, pat in {
    "gerúndio": r"\b[A-ZÀ-Ü]?[a-zà-ü]+(?:ando|endo|indo)\b",
    "senha": r"[Ss]enha", "usuário": r"[Uu]suário", "estoque": r"[Ee]stoque",
    "e-mail": r"e-mail", "login": r"\blogin\b", "Ingestão": r"[Ii]ngest",
    "reparo": r"\breparo\b", "parte": r"\bparte\b", "exclu/delet": r"[Ee]xclu|[Dd]elet",
    "Conectado": r"[Cc]onectado", "Configurações": r"[Cc]onfigurações",
    "atrás": r"atrás", "andamento": r"andamento", "você": r"você",
    "celular": r"[Cc]elular", "tela": r"\b[Tt]ela\b", "arquivo": r"[Aa]rquivo",
}.items():
    n = len(re.findall(pat, text))
    if n: left[name] = n
print("Sobras:", left if left else "nenhuma")

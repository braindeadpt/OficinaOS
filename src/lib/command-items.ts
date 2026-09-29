import type { PermissionCheck } from "@shared/permissions";
import { can } from "@/hooks/use-can";
import { NAV_ITEMS } from "@/lib/navigation";

export type Translate = (key: string) => string;

export type CommandKind = "action" | "page";

export interface Command {
  /** Extra terms that do not appear in the label, e.g. "fatura" for "POS". */
  keywords: string[];
  kind: CommandKind;
  labelKey: string;
  perm: PermissionCheck;
  /**
   * Returns true to keep the palette open. The two-step sign out needs it: the
   * first press only arms it, and closing straight after would leave no way to
   * confirm.
   */
  run: () => boolean | undefined;
  to?: string;
}

/**
 * Catalog of everything the palette can jump to or run.
 *
 * Pages come from the shared navigation registry rather than a second hand-
 * written list, so a new destination becomes a palette entry for free. Actions
 * are the things that are not navigation: opening the intake modal, signing
 * out. The two-click sign-out mirrors the sidebar, so a stray Enter in a
 * palette cannot end someone's session.
 *
 * `run` is injected rather than imported so this module stays pure and
 * testable: it needs no router, no stores and no i18n instance.
 */
/**
 * Words a technician would actually type that do not appear in the label.
 * "fatura" and "caixa" reach the point of sale, "telemóvel" the parts stock,
 * and so on. This is the vocabulary of the shop floor, not of the menus.
 */
const PAGE_KEYWORDS: Record<string, string[]> = {
  "/": ["inicio", "home", "painel", "principal"],
  "/ai-analyst": ["ia", "assistente", "chat", "agente"],
  "/customers": ["ficha", "cliente", "telefone", "contacto"],
  "/jobs": ["os", "job", "reparacao", "tickets", "ordem", "servico"],
  "/notifications": ["alerta", "avisos", "inbox"],
  "/parts": ["pecas", "stock", "inventario", "material", "telemovel"],
  "/pos": ["pdv", "venda", "vender", "fatura", "faturas", "caixa", "tpa"],
  "/repairs": ["catalogo", "servicos", "precos"],
  "/reports": ["relatorio", "estatisticas", "numeros", "margem"],
  "/returns": ["devolucao", "garantia", "reclamacao"],
  "/settings": ["definicoes", "configuracao", "loja", "preferencias"],
};

export function buildCommands(deps: {
  logout: () => void;
  navigate: (to: string) => void;
  openIntakeModal: () => void;
  role: string;
  signOut: () => boolean | undefined;
}): Command[] {
  const pages: Command[] = NAV_ITEMS.map((item) => ({
    keywords: PAGE_KEYWORDS[item.to] ?? [],
    kind: "page",
    labelKey: item.labelKey,
    perm: item.perm,
    run: () => {
      deps.navigate(item.to);
    },
    to: item.to,
  }));

  const actions: Command[] = [
    {
      keywords: ["entrada", "intake", "criar", "new", "job", "os"],
      kind: "action",
      labelKey: "new_checkin",
      perm: { jobs: ["create"] },
      run: () => {
        deps.openIntakeModal();
      },
    },
    {
      keywords: ["perfil", "conta", "profile", "account", "utilizador", "user"],
      kind: "action",
      labelKey: "profile_title",
      perm: { settings: ["view"] },
      run: () => {
        deps.navigate("/profile");
      },
      to: "/profile",
    },
    {
      keywords: ["definicoes", "config", "settings", "preferences", "opcoes"],
      kind: "action",
      labelKey: "settings",
      perm: { settings: ["view"] },
      run: () => {
        deps.navigate("/settings");
      },
      to: "/settings",
    },
    {
      keywords: ["sair", "logout", "terminar", "sessao", "sign out", "exit"],
      kind: "action",
      labelKey: "auth_sign_out_instead",
      perm: {},
      run: () => deps.signOut(),
    },
  ];

  return [...actions, ...pages].filter((c) => can(deps.role, c.perm));
}

const DIACRITICS = /[\u0300-\u036f]/g;
const WORD_BOUNDARY = /[\s/-]/;
const WHITESPACE = /\s+/;

function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      // Strip diacritics so "relaçōes" matches "relacoes" and "acções" matches
      // "accoes", which is how people type when they are in a hurry.
      .replace(DIACRITICS, "")
  );
}

/**
 * Ranks one command against the query. Higher is better; 0 means no match.
 *
 * A plain substring test is not enough: typing "rep" should surface "Reparações"
 * and "Repetições" far above "Preparar", and typing "set" should not rank
 * "Definições" below "Pos". Matching every whitespace-separated term also lets
 * "vendas pdv" find "Ponto de venda" through its keywords.
 */
export function scoreCommand(
  query: string,
  label: string,
  keywords: string[]
): number {
  if (!query) {
    return 1;
  }
  // The query is normalized too, not just the label: without it, typing
  // "relações" with the cedilla would never match a normalized label.
  const terms = normalize(query).split(WHITESPACE).filter(Boolean);
  if (terms.length === 0) {
    return 1;
  }

  const haystack = [normalize(label), ...keywords.map(normalize)];
  let total = 0;

  for (const term of terms) {
    let best = 0;
    for (const [index, candidate] of haystack.entries()) {
      const at = candidate.indexOf(term);
      if (at === -1) {
        continue;
      }
      // Word-start matches beat mid-word, prefix beats substring, and the
      // visible label outranks a keyword so "peças" does not drag in "POS".
      const wordStart = at === 0 || WORD_BOUNDARY.test(candidate[at - 1] ?? "");
      const score = (wordStart ? 100 : 40) - at + (index === 0 ? 10 : 0);
      best = Math.max(best, score);
    }
    if (best === 0) {
      // Every term has to land somewhere, so "zzz clientes" finds nothing.
      return 0;
    }
    total += best;
  }

  return total;
}

export interface ScoredCommand extends Command {
  label: string;
  score: number;
}

export function filterCommands(
  commands: Command[],
  query: string,
  t: Translate
): ScoredCommand[] {
  const trimmed = query.trim();
  return commands
    .map((command) => {
      const label = t(command.labelKey);
      return {
        ...command,
        label,
        score: scoreCommand(trimmed, label, command.keywords),
      };
    })
    .filter((command) => command.score > 0)
    .sort((a, b) => b.score - a.score);
}

import { AppError } from "@shared/errors/app-error.js";
import type { FastifyInstance, FastifyRequest } from "fastify";

export const SHOP_MODE_PONTO_ONLY = "ponto_only";

function sameOrChild(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Superfícies de reparações/stock/caixa/POS que deixam de existir numa
// instância só-ponto. O frontend esconde-as; este guard fecha a API para
// que o modo seja também uma permissão, não apenas uma camada visual.
const BLOCKED_EXACT_OR_CHILD = [
  // reparações e operação de clientes
  "/api/jobs",
  "/api/repairs",
  "/api/workflow",
  "/api/intake-requests",
  "/api/return-claims",
  "/api/external-repairs",
  "/api/referrals",
  "/api/sign-sessions",
  "/api/customers",
  "/api/tasks",
  // stock e catálogo
  "/api/parts",
  "/api/brands",
  "/api/purchase-orders",
  "/api/suppliers",
  "/api/supplier-rmas",
  "/api/part-requests",
  "/api/market-prices",
  "/api/loaners",
  "/api/trade-ins",
  // caixa, POS e métricas do negócio
  "/api/payments",
  "/api/receipts",
  "/api/reports",
  "/api/dashboard",
  "/api/sales",
  "/api/invoicing",
  "/api/storefront",
  // canais/automação de clientes e importação de dados da oficina
  "/api/business",
  "/api/inbox",
  "/api/ai",
  "/api/export",
  "/api/import",
] as const;

export function isPontoOnlyBlockedApiPath(pathname: string): boolean {
  return BLOCKED_EXACT_OR_CHILD.some((prefix) => sameOrChild(pathname, prefix));
}

function pathnameOf(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? request.url;
}

/**
 * Regista o guard raiz antes das rotas de negócio. A consulta é pequena e
 * só corre nos prefixes bloqueados — o tráfego normal do ponto/settings
 * não paga uma leitura extra por pedido.
 */
export function registerPontoOnlyApiGuard(app: FastifyInstance): void {
  app.addHook("preHandler", async (request) => {
    const pathname = pathnameOf(request);
    if (!isPontoOnlyBlockedApiPath(pathname)) {
      return;
    }
    const settings = await app.prisma.shopSettings.findUnique({
      select: { shopMode: true },
      where: { id: "default" },
    });
    if (settings?.shopMode === SHOP_MODE_PONTO_ONLY) {
      throw new AppError("NOT_FOUND");
    }
  });
}

import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { cloudFetch } from "./cloud.service.js";

/**
 * Multi-loja dashboard (módulo Pro "multi-shop"): a loja empurra um
 * snapshot agregado por dia — receita, contagens de reparações/vendas.
 * Só saem números: nenhum dado de clientes ou reparações individuais.
 * A cloud guarda uma linha por (loja, dia) e o dono vê o agregado de
 * todas as suas lojas no dashboard em cloud.oficinaos.app.
 */

interface DayMetrics {
  activeJobs: number;
  date: string;
  jobsDelivered: number;
  jobsOpened: number;
  newCustomers: number;
  revenueCents: number;
  salesCents: number;
  salesCount: number;
}

/** Local calendar bounds [start, end) of the given day. */
function dayBounds(day: Date): { start: Date; end: Date } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function localDateString(day: Date): string {
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${m}-${d}`;
}

function toCents(amount: unknown): number {
  return Math.round(Number(amount ?? 0) * 100);
}

/** Aggregate one shop-local calendar day into a metrics row. */
export async function computeDailyMetrics(
  prisma: PrismaClient,
  day: Date
): Promise<DayMetrics> {
  const { start, end } = dayBounds(day);
  const inDay = { gte: start, lt: end };

  const [
    salePayments,
    jobPayments,
    jobsOpened,
    jobsDelivered,
    sales,
    salesTotal,
    activeJobs,
    newCustomers,
  ] = await Promise.all([
    prisma.salePayment.aggregate({
      _sum: { amount: true },
      where: { createdAt: inDay },
    }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { createdAt: inDay },
    }),
    prisma.job.count({ where: { createdAt: inDay } }),
    // No status-history table — "delivered that day" is approximated by
    // status=DELIVERED with last update inside the day.
    prisma.job.count({ where: { status: "DELIVERED", updatedAt: inDay } }),
    prisma.sale.count({ where: { createdAt: inDay } }),
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { createdAt: inDay },
    }),
    prisma.job.count({
      where: { status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED"] } },
    }),
    prisma.customer.count({ where: { createdAt: inDay } }),
  ]);

  return {
    date: localDateString(day),
    revenueCents:
      toCents(salePayments._sum.amount) + toCents(jobPayments._sum.amount),
    jobsOpened,
    jobsDelivered,
    salesCount: sales,
    salesCents: toCents(salesTotal._sum.total),
    activeJobs,
    newCustomers,
  };
}

/**
 * Push today + yesterday to the cloud — yesterday is recomputed so payments
 * recorded late still land. Idempotent upsert on the cloud side.
 */
export async function syncShopMetrics(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger
): Promise<void> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const days = await Promise.all([
    computeDailyMetrics(prisma, yesterday),
    computeDailyMetrics(prisma, today),
  ]);

  const res = await cloudFetch(apiUrl, "/shops/metrics", {
    body: { days },
    method: "POST",
    token,
  }).catch(() => null);

  if (!res) {
    log.warn("shop-metrics push failed — cloud unreachable");
    return;
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "shop-metrics push rejected");
  }
}

import type { PrismaClient } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { dayRange } from "../utils/time-range.js";
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

function toCents(amount: unknown): number {
  return Math.round(Number(amount ?? 0) * 100);
}

/** Aggregate one shop-local calendar day into a metrics row. */
export async function computeDailyMetrics(
  prisma: PrismaClient,
  tz: string,
  at: Date
): Promise<DayMetrics> {
  const { start, end, date } = dayRange(tz, at);
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
    date,
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
  // Same resolution as the dashboard scope: settings.timezone, env TZ, UTC.
  // Without it the "day" would be the server's, not the shop's.
  const settings = await getOrCreateShopSettings(prisma);
  const tz = settings.timezone ?? process.env.TZ ?? "UTC";

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const days = await Promise.all([
    computeDailyMetrics(prisma, tz, yesterday),
    computeDailyMetrics(prisma, tz, today),
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

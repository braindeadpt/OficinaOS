import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { lookupByCodeAuth } from "./job.service.js";
import { respondToQuote } from "./job-quote.service.js";

/**
 * Portal público via OficinaOS Cloud (módulo "portal"):
 * a loja publica um link por reparação; a app empurra a projeção pública
 * (a mesma da página LAN de tracking) e a cloud serve-a ao cliente em
 * https://cloud.../t/<accessCode>. Respostas a orçamentos voltam pelo
 * poller e entram no respondToQuote normal — o token é a credencial.
 */

const TRAILING_SLASH_RE = /\/+$/;

async function cloudAuth(
  prisma: PrismaClient
): Promise<{ apiUrl: string; token: string }> {
  const s = await getOrCreateShopSettings(prisma);
  if (!(s.cloudApiUrl && s.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  return {
    apiUrl: s.cloudApiUrl,
    token: decryptSecret(s.cloudShopTokenEncrypted),
  };
}

export function portalUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(TRAILING_SLASH_RE, "")}/t/${token}`;
}

/** Publica/atualiza a página pública de uma reparação e devolve o link. */
export async function publishJobPortal(
  prisma: PrismaClient,
  jobId: string,
  log: FastifyBaseLogger
): Promise<{ url: string }> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { accessCode: true, id: true, jobCode: true },
  });
  if (!job) {
    throw new AppError("JOB_NOT_FOUND");
  }
  const { apiUrl, token } = await cloudAuth(prisma);
  const data = await lookupByCodeAuth(prisma, job.jobCode);
  if (!data) {
    throw new AppError("JOB_NOT_FOUND");
  }

  const res = await cloudFetch(apiUrl, "/portal/publish", {
    body: { token: job.accessCode, jobCode: job.jobCode, data },
    method: "POST",
    token,
  }).catch(() => null);
  if (!res) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  if (res.status === 402) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "portal publish failed");
    throw new AppError("CLOUD_PAIRING_FAILED");
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { portalPublishedAt: new Date() },
  });
  return { url: portalUrl(apiUrl, job.accessCode) };
}

/** Retira a página pública — o link deixa de existir na cloud. */
export async function unpublishJobPortal(
  prisma: PrismaClient,
  jobId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { accessCode: true },
  });
  if (!job) {
    throw new AppError("JOB_NOT_FOUND");
  }
  const { apiUrl, token } = await cloudAuth(prisma);
  const res = await cloudFetch(apiUrl, `/portal/pages/${job.accessCode}`, {
    method: "DELETE",
    token,
  }).catch(() => null);
  if (res && !res.ok && res.status !== 404) {
    log.warn({ status: res.status }, "portal unpublish failed");
  }
  await prisma.job.update({
    where: { id: jobId },
    data: { portalPublishedAt: null },
  });
}

interface CloudPage {
  jobCode: string;
  token: string;
  updatedAt: string;
}

interface CloudReply {
  data: { decision?: string; note?: string; quoteId?: string };
  id: string;
  kind: string;
  page: { jobCode: string };
}

interface SyncCtx {
  apiUrl: string;
  log: FastifyBaseLogger;
  notifyCtx: NotifyContext | undefined;
  prisma: PrismaClient;
  token: string;
}

/** Re-publica páginas cujo job mudou desde o último push para a cloud. */
async function republishStalePages(ctx: SyncCtx): Promise<void> {
  const pagesRes = await cloudFetch(ctx.apiUrl, "/shops/portal-pages", {
    token: ctx.token,
  });
  if (!pagesRes.ok) {
    return;
  }
  const cloudPages = (pagesRes.body as { pages?: CloudPage[] }).pages ?? [];
  const pages = cloudPages.reduce<Record<string, Date>>((m, p) => {
    m[p.token] = new Date(p.updatedAt);
    return m;
  }, {});

  const published = await ctx.prisma.job.findMany({
    where: { portalPublishedAt: { not: null } },
    select: {
      accessCode: true,
      id: true,
      jobCode: true,
      updatedAt: true,
    },
  });
  const liveTokens = new Set(published.map((j) => j.accessCode));

  // Órfãs: páginas públicas na cloud mas despublicadas localmente
  // (a loja removeu o link enquanto a cloud estava inacessível).
  for (const page of cloudPages) {
    if (!liveTokens.has(page.token)) {
      await cloudFetch(ctx.apiUrl, `/portal/pages/${page.token}`, {
        method: "DELETE",
        token: ctx.token,
      }).catch(() => null);
    }
  }

  for (const job of published) {
    const cloudStamp = pages[job.accessCode];
    if (cloudStamp && cloudStamp >= job.updatedAt) {
      continue;
    }
    try {
      const data = await lookupByCodeAuth(ctx.prisma, job.jobCode);
      if (!data) {
        continue;
      }
      await cloudFetch(ctx.apiUrl, "/portal/publish", {
        body: { token: job.accessCode, jobCode: job.jobCode, data },
        method: "POST",
        token: ctx.token,
      });
    } catch (err) {
      ctx.log.warn({ err, jobId: job.id }, "portal re-publish failed");
    }
  }
}

/** Aplica uma resposta de orçamento vinda do portal público. */
async function applyReply(ctx: SyncCtx, reply: CloudReply): Promise<void> {
  if (reply.kind !== "quote" || !(reply.data.quoteId && reply.data.decision)) {
    return;
  }
  const job = await ctx.prisma.job.findFirst({
    where: { jobCode: reply.page.jobCode },
    select: {
      accessCode: true,
      customer: { select: { phone: true } },
    },
  });
  const digits = job?.customer?.phone?.replace(/\D/g, "") ?? "";
  if (!(job && digits.length >= 4)) {
    return;
  }
  // O token do portal é a prova — passamos o phone4 real à validação
  // interna existente (mesmo serviço, mesmo audit trail).
  const result = await respondToQuote(
    ctx.prisma,
    {
      code: reply.page.jobCode,
      decision: reply.data.decision === "approve" ? "approve" : "reject",
      note: reply.data.note,
      phone4: digits.slice(-4),
      quoteId: reply.data.quoteId,
    },
    ctx.notifyCtx ?? { prisma: ctx.prisma }
  );
  if (result.error) {
    ctx.log.info(
      { error: result.error, replyId: reply.id },
      "portal reply not applied"
    );
    return;
  }
  // Re-publish immediately so a customer reload sees the decision they
  // just made (the 2-min poller would leave the quote showing as SENT).
  const data = await lookupByCodeAuth(ctx.prisma, reply.page.jobCode);
  if (data) {
    await cloudFetch(ctx.apiUrl, "/portal/publish", {
      body: {
        token: job.accessCode,
        jobCode: reply.page.jobCode,
        data,
      },
      method: "POST",
      token: ctx.token,
    }).catch(() => null);
  }
}

/** Recolhe respostas de clientes e confirma-as na cloud (ack). */
async function collectReplies(ctx: SyncCtx): Promise<void> {
  const repliesRes = await cloudFetch(ctx.apiUrl, "/portal/replies", {
    token: ctx.token,
  });
  if (!repliesRes.ok) {
    return;
  }
  const replies = (repliesRes.body as { replies?: CloudReply[] }).replies ?? [];
  if (replies.length === 0) {
    return;
  }

  const ackIds: string[] = [];
  for (const r of replies) {
    try {
      await applyReply(ctx, r);
      ackIds.push(r.id);
    } catch (err) {
      ctx.log.warn({ err, replyId: r.id }, "portal reply failed");
      ackIds.push(r.id); // poisoned reply — don't retry forever
    }
  }

  await cloudFetch(ctx.apiUrl, "/portal/replies/ack", {
    body: { ids: ackIds },
    method: "POST",
    token: ctx.token,
  });
}

/**
 * Chamado pelo poller quando a loja tem o módulo "portal":
 * 1) re-publica páginas cujo job mudou desde o último push;
 * 2) aplica respostas de orçamento vindas dos clientes.
 */
export async function syncPortal(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<void> {
  const ctx: SyncCtx = { apiUrl, log, notifyCtx, prisma, token };
  await republishStalePages(ctx);
  await collectReplies(ctx);
}

import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants/roles.js";
import type { FastifyBaseLogger } from "fastify";
import { create as createIntakeRequest } from "../repositories/intake-request.repository.js";
import { findManyUsers } from "../repositories/notification.repository.js";
import type { DbClient } from "../repositories/types.js";
import { generateIntakeRequestCode } from "../utils/intake-request-code.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { notify } from "./notification-dispatch.js";

const TRAILING_SLASH_RE = /\/+$/;

/**
 * Loja online (módulo Pro "storefront"): a loja marca artigos do catálogo
 * como "listados online"; a app empurra a montra para a cloud, que serve
 * a página pública em https://<cloud>/loja/<slug>. Reservas de clientes
 * voltam pelo poller e entram na fila de Pedidos como IntakeRequest.
 */

export function storefrontUrl(apiUrl: string, slug: string): string {
  return `${apiUrl.replace(TRAILING_SLASH_RE, "")}/loja/${slug}`;
}

/** Marca a montra como "por sincronizar" — o próximo poll empurra-a. */
export async function markStoreDirty(prisma: DbClient): Promise<void> {
  await prisma.shopSettings.update({
    where: { id: "default" },
    data: { storeDirty: true },
  });
}

/**
 * Stock muda fora do catálogo (vendas POS, consumo em jobs, movimentos) —
 * marca dirty só se o artigo estiver listado na montra. Nunca propaga
 * erros: falhar a marcação não pode abortar a operação que a chamou.
 */
export async function markStoreDirtyIfListed(
  prisma: PrismaClient,
  partId: string
): Promise<void> {
  try {
    const part = await prisma.partsCatalog.findUnique({
      where: { id: partId },
      select: { listedOnline: true },
    });
    if (part?.listedOnline) {
      await markStoreDirty(prisma);
    }
  } catch {
    // best-effort
  }
}

interface SettingsRow {
  address: string | null;
  cloudEntitlements: unknown;
  phone: string | null;
  storeAccentColor: string | null;
  storeDescription: string | null;
  storeDirty: boolean;
  storeEmail: string | null;
  storeLogoData: string | null;
  storePublished: boolean;
  storeSlug: string | null;
  storeTemplate: string | null;
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/;

/** "data:image/png;base64,XXX" → { mime, dataBase64 } para o PUT da cloud. */
function splitDataUrl(
  dataUrl: string | null
): { dataBase64: string; mime: string } | null {
  const match = DATA_URL_RE.exec(dataUrl ?? "");
  return match ? { dataBase64: match[2], mime: match[1] } : null;
}

/**
 * Empurra config + artigos listados para a cloud quando storeDirty.
 * Devolve o slug efetivo (a cloud pode auto-gerar ou rejeitar colisões).
 */
export async function pushStorefront(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger
): Promise<void> {
  const settings = (await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  })) as unknown as SettingsRow;
  if (!settings.storeDirty) {
    return;
  }

  const items = await prisma.partsCatalog.findMany({
    where: { listedOnline: true, isActive: true },
    select: {
      id: true,
      name: true,
      category: true,
      defaultPrice: true,
      stockQuantity: true,
    },
    orderBy: { name: "asc" },
    take: 500,
  });

  // Tema pago: a cloud trata o PUT como snapshot completo — campos de tema
  // ausentes voltam aos defaults. Só se enviam com o entitlement plus em
  // cache; sem ele, a cloud rejeitaria o push inteiro (402).
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[])
    : [];
  const theme = modules.includes("storefront-plus")
    ? {
        accentColor: settings.storeAccentColor ?? null,
        logo: splitDataUrl(settings.storeLogoData),
        template:
          settings.storeTemplate === "compacta" ? "compacta" : "vitrine",
      }
    : {};

  const res = await cloudFetch(apiUrl, "/storefront", {
    body: {
      address: settings.address ?? undefined,
      description: settings.storeDescription ?? undefined,
      email: settings.storeEmail ?? undefined,
      items: items.map((p) => ({
        category: p.category,
        externalId: p.id,
        inStock: p.stockQuantity > 0,
        name: p.name,
        priceCents: Math.round(Number(p.defaultPrice) * 100),
      })),
      phone: settings.phone ?? undefined,
      published: settings.storePublished,
      slug: settings.storeSlug ?? undefined,
      ...theme,
    },
    method: "PUT",
    token,
  }).catch(() => null);

  if (!res) {
    log.warn("storefront push failed — cloud unreachable");
    return;
  }
  if (!res.ok) {
    log.warn({ status: res.status }, "storefront push rejected");
    return;
  }

  const slug = (res.body as { slug?: string }).slug;
  await prisma.shopSettings.update({
    where: { id: "default" },
    data: {
      storeDirty: false,
      ...(slug ? { storeSlug: slug } : {}),
    },
  });
}

interface CloudReservation {
  customerName: string;
  customerPhone: string;
  id: string;
  itemName: string;
  note: string | null;
  priceCents: number | null;
}

/** Reservas pendentes viram pedidos de intake (dedupe por externalId). */
async function collectReservations(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/storefront/reservations", {
    token,
  });
  if (!res.ok) {
    return;
  }
  const reservations =
    (res.body as { reservations?: CloudReservation[] }).reservations ?? [];
  if (reservations.length === 0) {
    return;
  }

  const ackIds: string[] = [];
  for (const r of reservations) {
    if (!(r.customerName && r.customerPhone)) {
      ackIds.push(r.id);
      continue;
    }
    try {
      const price =
        r.priceCents == null ? "" : ` — ${(r.priceCents / 100).toFixed(2)}€`;
      const request = await createIntakeRequest(prisma, {
        code: await generateIntakeRequestCode(prisma),
        customerEmail: null,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        deviceLabel: r.itemName,
        externalId: `store:${r.id}`,
        problem:
          `Reserva loja online: ${r.itemName}${price}` +
          (r.note ? `\nNota do cliente: ${r.note}` : ""),
        whatsappOptIn: false,
      });
      ackIds.push(r.id);
      notifyStaff(prisma, request, notifyCtx, log);
    } catch (err) {
      // P2002 on externalId = já importada — confirma mesmo assim.
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "P2002"
      ) {
        ackIds.push(r.id);
      } else {
        log.warn({ err, reservationId: r.id }, "store reservation failed");
      }
    }
  }

  if (ackIds.length) {
    await cloudFetch(apiUrl, "/storefront/reservations/ack", {
      body: { ids: ackIds },
      method: "POST",
      token,
    });
  }
}

function notifyStaff(
  prisma: PrismaClient,
  request: { code: string; customerName: string; deviceLabel: string },
  notifyCtx: NotifyContext | undefined,
  log: FastifyBaseLogger
): void {
  if (!notifyCtx) {
    return;
  }
  findManyUsers(
    prisma,
    { isActive: true, role: { in: [Role.OWNER, Role.FRONT_DESK] } },
    { id: true }
  )
    .then((users) =>
      users.length
        ? notify(notifyCtx, {
            context: {
              customerName: request.customerName,
              deviceLabel: request.deviceLabel,
              requestCode: request.code,
            },
            eventName: "pre_check_submitted",
            recipients: { userIds: users.map((u) => u.id) },
          })
        : undefined
    )
    .catch((err) => log.warn({ err }, "storefront notification failed"));
}

/** Chamado pelo poller quando a loja tem o módulo "storefront". */
export async function syncStorefront(
  prisma: PrismaClient,
  apiUrl: string,
  token: string,
  log: FastifyBaseLogger,
  notifyCtx?: NotifyContext
): Promise<void> {
  await pushStorefront(prisma, apiUrl, token, log);
  await collectReservations(prisma, apiUrl, token, log, notifyCtx);
}

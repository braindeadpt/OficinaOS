import { AppError } from "@shared/errors/app-error.js";
import type {
  PontoInfoDeliveriesResponse,
  PontoInfoDeliveryDTO,
} from "@shared/types/ponto";
import type { DbClient } from "../repositories/types.js";

function deliveryDTO(row: {
  deliveredAt: Date;
  registeredById: string;
  registeredByName: string;
  signed: boolean;
  updatedAt: Date;
}): PontoInfoDeliveryDTO {
  return {
    deliveredAt: row.deliveredAt.toISOString().slice(0, 10),
    registeredById: row.registeredById,
    registeredByName: row.registeredByName,
    signed: row.signed,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPontoInfoDeliveries(
  prisma: DbClient
): Promise<PontoInfoDeliveriesResponse> {
  const users = await prisma.user.findMany({
    orderBy: [{ name: "asc" }, { username: "asc" }],
    select: {
      id: true,
      isActive: true,
      name: true,
      pontoEnabled: true,
      pontoInfoDelivery: true,
      username: true,
    },
    where: { pontoEnabled: true },
  });
  const rows = users.map((user) => ({
    delivery: user.pontoInfoDelivery
      ? deliveryDTO(user.pontoInfoDelivery)
      : null,
    isActive: user.isActive,
    name: user.name || user.username,
    pontoEnabled: user.pontoEnabled,
    userId: user.id,
    username: user.username,
  }));
  return {
    missingActiveCount: rows.filter(
      (row) => row.isActive && row.pontoEnabled && !row.delivery
    ).length,
    rows,
  };
}

export async function upsertPontoInfoDelivery(
  prisma: DbClient,
  args: {
    actorId: string;
    deliveredAt: string;
    signed: boolean;
    tz: string;
    userId: string;
  }
) {
  // Uma entrega no futuro não pode contar como concluída — o trabalhador
  // desaparecia logo do aviso sem a folha lhe ter chegado. A comparação
  // faz-se no dia civil DA LOJA, não no do dispositivo.
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: args.tz,
    year: "numeric",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const todayKey = `${part("year")}-${part("month")}-${part("day")}`;
  if (args.deliveredAt > todayKey) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { deliveredAt: ["validations.ponto_delivery_future"] },
    });
  }
  const user = await prisma.user.findUnique({
    select: { id: true, pontoEnabled: true },
    where: { id: args.userId },
  });
  if (!user) {
    throw new AppError("USER_NOT_FOUND");
  }
  if (!user.pontoEnabled) {
    throw new AppError("VALIDATION_ERROR", {
      errors: { userId: ["validations.ponto_user_not_enabled"] },
    });
  }
  const actor = await prisma.user.findUnique({
    select: { id: true, name: true, username: true },
    where: { id: args.actorId },
  });
  if (!actor) {
    throw new AppError("USER_NOT_FOUND");
  }
  const actorName = actor.name || actor.username;
  const row = await prisma.pontoInfoDelivery.upsert({
    create: {
      deliveredAt: new Date(`${args.deliveredAt}T00:00:00.000Z`),
      registeredById: actor.id,
      registeredByName: actorName,
      signed: args.signed,
      userId: args.userId,
    },
    update: {
      deliveredAt: new Date(`${args.deliveredAt}T00:00:00.000Z`),
      registeredById: actor.id,
      registeredByName: actorName,
      signed: args.signed,
    },
    where: { userId: args.userId },
  });
  return deliveryDTO(row);
}

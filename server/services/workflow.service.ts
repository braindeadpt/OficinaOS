import type { PrismaClient } from "@generated/client";
import {
  WORKFLOW_PERMISSIONS,
  type WorkflowType,
} from "@shared/constants/workflow";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyRequest } from "fastify";
import { getRole, getUserId } from "../utils/request.js";

export async function findWorkflowRecord(
  prisma: PrismaClient,
  type: WorkflowType,
  id?: string
) {
  if (type === "GENERAL") {
    if (id) {
      throw new AppError("VALIDATION_ERROR");
    }
    return;
  }
  if (!id) {
    throw new AppError("VALIDATION_ERROR");
  }
  const where = { id };
  const record = await (() => {
    switch (type) {
      case "TICKET":
        return prisma.supportTicket.findUnique({ where });
      case "MESSAGE":
        return prisma.businessMessage.findUnique({ where });
      case "AGREEMENT":
        return prisma.commercialAgreement.findUnique({ where });
      case "JOB":
        return prisma.job.findUnique({ where });
      case "RMA":
        return prisma.supplierRma.findUnique({ where });
      case "REQUEST":
        return prisma.intakeRequest.findUnique({ where });
      case "RETURN":
        return prisma.returnClaim.findUnique({ where });
      case "ORDER":
        return prisma.purchaseOrder.findUnique({ where });
      case "TRADE_IN":
        return prisma.tradeIn.findUnique({ where });
      case "SUPPLIER":
        return prisma.supplier.findUnique({ where });
      case "CUSTOMER":
        return prisma.customer.findUnique({ where });
      default:
        return null;
    }
  })();
  if (!record) {
    throw new AppError("NOT_FOUND");
  }
}

export async function authorizeWorkflow(
  req: FastifyRequest,
  type: WorkflowType,
  action: "view" | "edit",
  id?: string
) {
  const permission = WORKFLOW_PERMISSIONS[type][action];
  const allowed = await req.server.auth.api.userHasPermission({
    body: { role: getRole(req), permissions: permission },
  });
  if (!allowed.success) {
    throw new AppError("FORBIDDEN");
  }
  await findWorkflowRecord(req.server.prisma, type, id);
  if (type === "RETURN") {
    const shop = await req.server.auth.api.userHasPermission({
      body: { role: getRole(req), permissions: { returns: ["viewShop"] } },
    });
    if (!shop.success) {
      const claim = await req.server.prisma.returnClaim.findFirst({
        where: {
          id,
          OR: [
            { openedById: getUserId(req) },
            { originalJob: { technicianId: getUserId(req) } },
            { reworkJob: { technicianId: getUserId(req) } },
          ],
        },
      });
      if (!claim) {
        throw new AppError("NOT_FOUND");
      }
    }
  }
}

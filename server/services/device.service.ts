import type { PrismaClient } from "@generated/client";
import { Prisma } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  BrandSearchQueryInput,
  CreateBrandInput,
  CreateModelInput,
  ModelSearchQueryInput,
} from "@shared/schemas/device.schema";
import {
  createBrand as createBrandRepo,
  createDevice as createDeviceRepo,
  findBrandFirst as findBrandFirstRepo,
  findBrands as findBrandsRepo,
  findBrandUnique,
  findDeviceFirst as findDeviceFirstRepo,
  findDevices as findDevicesRepo,
} from "../repositories/device.repository.js";

export async function searchBrands(
  prisma: PrismaClient,
  query: BrandSearchQueryInput
) {
  const { q, limit } = query;
  if (!q) {
    return await findBrandsRepo(prisma, {}, { name: "asc" }, limit);
  }
  return await findBrandsRepo(
    prisma,
    { name: { startsWith: q, mode: "insensitive" } },
    { name: "asc" },
    limit
  );
}

export async function searchModels(
  prisma: PrismaClient,
  brandId: string,
  query: ModelSearchQueryInput
) {
  const { q, limit } = query;
  const brand = await findBrandUnique(prisma, brandId);
  if (!brand) {
    throw new AppError("BRAND_NOT_FOUND");
  }
  if (!q) {
    return await findDevicesRepo(
      prisma,
      { brandId },
      { id: true, brandId: true, model: true, category: true },
      { model: "asc" },
      limit
    );
  }
  return await findDevicesRepo(
    prisma,
    { brandId, model: { startsWith: q, mode: "insensitive" } },
    { id: true, brandId: true, model: true, category: true },
    { model: "asc" },
    limit
  );
}

export async function createBrand(
  prisma: PrismaClient,
  input: CreateBrandInput
) {
  const existing = await findBrandFirstRepo(prisma, {
    name: { equals: input.name, mode: "insensitive" },
  });
  if (existing) {
    return existing;
  }
  try {
    return await createBrandRepo(prisma, { name: input.name });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return await findBrandFirstRepo(prisma, {
        name: { equals: input.name, mode: "insensitive" },
      });
    }
    throw err;
  }
}

export async function createModel(
  prisma: PrismaClient,
  brandId: string,
  input: CreateModelInput
) {
  const brand = await findBrandUnique(prisma, brandId);
  if (!brand) {
    throw new AppError("BRAND_NOT_FOUND");
  }
  const existing = await findDeviceFirstRepo(prisma, {
    brandId,
    model: { equals: input.model, mode: "insensitive" },
  });
  if (existing) {
    return existing;
  }
  try {
    return await createDeviceRepo(prisma, {
      brand: { connect: { id: brandId } },
      model: input.model,
      category: input.category ?? null,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return await findDeviceFirstRepo(prisma, {
        brandId,
        model: { equals: input.model, mode: "insensitive" },
      });
    }
    throw err;
  }
}

import {
  JobStatus as PrismaJobStatus,
  PartCategory as PrismaPartCategory,
  QuoteStatus as PrismaQuoteStatus,
  RepairCategory as PrismaRepairCategory,
  Role as PrismaRole,
} from "@generated/enums";
import {
  JobStatus,
  PartCategory,
  QuoteStatus,
  RepairCategory,
  Role,
} from "@shared/constants";
import { describe, expect, it } from "vitest";

describe("enum sync: shared constants match Prisma generated enums", () => {
  it("JobStatus matches Prisma enum", () => {
    const prismaValues = Object.values(PrismaJobStatus).sort();
    const sharedValues = Object.values(JobStatus).sort();
    expect(sharedValues).toEqual(prismaValues);
  });

  it("Role matches Prisma enum", () => {
    const prismaValues = Object.values(PrismaRole).sort();
    const sharedValues = Object.values(Role).sort();
    expect(sharedValues).toEqual(prismaValues);
  });

  it("PartCategory matches Prisma enum", () => {
    const prismaValues = Object.values(PrismaPartCategory).sort();
    const sharedValues = Object.values(PartCategory).sort();
    expect(sharedValues).toEqual(prismaValues);
  });

  it("RepairCategory matches Prisma enum", () => {
    const prismaValues = Object.values(PrismaRepairCategory).sort();
    const sharedValues = Object.values(RepairCategory).sort();
    expect(sharedValues).toEqual(prismaValues);
  });

  it("QuoteStatus matches Prisma enum", () => {
    const prismaValues = Object.values(PrismaQuoteStatus).sort();
    const sharedValues = Object.values(QuoteStatus).sort();
    expect(sharedValues).toEqual(prismaValues);
  });
});

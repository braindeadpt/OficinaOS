/**
 * seeds a fictional demo dataset for screenshots/QA — Portuguese shop,
 * plausible repairs, revenue spread over the last weeks. Idempotent:
 * re-running deletes the previous demo set first (matched by phone list).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";
import { generateJobCode } from "../server/utils/job-code.js";
import { generateSaleCode } from "../server/utils/sale-code.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const daysAgo = (n: number, h = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 15, 0, 0);
  return d;
};

const CUSTOMERS = [
  { name: "Mariana Costa", phone: "912345678", email: "mariana.costa@mail.com" },
  { name: "João Ferreira", phone: "934567890", email: "joao.ferreira@mail.com" },
  { name: "Ana Rodrigues", phone: "965432109" },
  { name: "Rui Almeida", phone: "917654321", email: "rui.almeida@sapo.pt" },
  { name: "Carla Nunes", phone: "921098765" },
  { name: "Tiago Pereira", phone: "936781245", email: "tiago.pereira@mail.com" },
  { name: "Sofia Martins", phone: "968731245" },
  { name: "Bruno Carvalho", phone: "913579246", email: "bruno.carvalho@mail.com" },
  { name: "Inês Sousa", phone: "927418536" },
  { name: "Miguel Fonseca", phone: "916283745", email: "miguel.fonseca@mail.com" },
];

const PARTS = [
  { name: "Ecrã iPhone 13 (OLED)", category: "SCREEN", price: 89.9, stock: 4, reorder: 2 },
  { name: "Ecrã iPhone 14", category: "SCREEN", price: 109.9, stock: 2, reorder: 2 },
  { name: "Ecrã Samsung Galaxy A54", category: "SCREEN", price: 64.9, stock: 3, reorder: 2 },
  { name: "Ecrã Xiaomi Redmi Note 13", category: "SCREEN", price: 39.9, stock: 2, reorder: 2 },
  { name: "Bateria iPhone 12", category: "BATTERY", price: 24.9, stock: 6, reorder: 3 },
  { name: "Bateria Samsung Galaxy S23", category: "BATTERY", price: 29.9, stock: 1, reorder: 2 },
  { name: "Conector de carga USB-C", category: "CHARGING_PORT", price: 12.5, stock: 8, reorder: 3 },
  { name: "Câmara traseira iPhone 13", category: "CAMERA", price: 45.0, stock: 1, reorder: 1 },
  { name: "Película vidro temperado", category: "OTHER", price: 4.9, stock: 25, reorder: 10 },
  { name: "Capa silicone iPhone 14", category: "OTHER", price: 6.9, stock: 12, reorder: 5 },
  { name: "Carregador 20W USB-C", category: "OTHER", price: 11.9, stock: 0, reorder: 3 },
];

// [customerIdx, deviceModel, problem, status, createdDaysAgo, deliveredDaysAgo|null, repairs[], parts[], quote]
const JOBS: Array<{
  cust: number;
  device: string;
  problem: string;
  status: string;
  created: number;
  delivered?: number;
  repairs: Array<[string, string, number]>;
  parts?: Array<[string, string, number, number]>; // name, category, unitPrice, qty
  quote?: { amount: number; status: string; note?: string };
  deposit?: number;
  payMethod?: string;
  urgent?: boolean;
  estDays: number;
  waiting?: string;
  note?: string;
}> = [
  // — delivered (feed the revenue chart; delivered-day via audit row) —
  { cust: 0, device: "iPhone 13", problem: "Ecrã partido após queda", status: "DELIVERED", created: 24, delivered: 22, repairs: [["Substituição de ecrã", "HARDWARE", 95]], parts: [["Ecrã iPhone 13 (OLED)", "SCREEN", 89.9, 1]], payMethod: "MB_WAY", estDays: 2 },
  { cust: 1, device: "Galaxy S24", problem: "Bateria descarrega em poucas horas", status: "DELIVERED", created: 15, delivered: 13, repairs: [["Substituição de bateria", "HARDWARE", 45]], parts: [["Bateria Samsung Galaxy S23", "BATTERY", 29.9, 1]], payMethod: "CARD", estDays: 1 },
  { cust: 2, device: "Redmi Note 13", problem: "Não carrega — porta USB-C solta", status: "DELIVERED", created: 10, delivered: 8, repairs: [["Substituição conector de carga", "HARDWARE", 35]], parts: [["Conector de carga USB-C", "CHARGING_PORT", 12.5, 1]], payMethod: "CASH", estDays: 3 },
  { cust: 3, device: "iPhone 12", problem: "Ecrã rachado + Face ID falha", status: "DELIVERED", created: 7, delivered: 6, repairs: [["Substituição de ecrã", "HARDWARE", 85], ["Calibração Face ID", "OTHER", 20]], parts: [["Ecrã iPhone 13 (OLED)", "SCREEN", 89.9, 1]], payMethod: "MB_WAY", estDays: 2 },
  { cust: 4, device: "Galaxy A54", problem: "Caiu à água, não liga", status: "DELIVERED", created: 5, delivered: 4, repairs: [["Limpeza ultrassons + diagnóstico", "DIAGNOSTIC", 40], ["Substituição de ecrã", "HARDWARE", 70]], parts: [["Ecrã Samsung Galaxy A54", "SCREEN", 64.9, 1]], payMethod: "CARD", estDays: 4 },
  { cust: 5, device: "iPhone 14", problem: "Ecrã partido", status: "DELIVERED", created: 3, delivered: 2, repairs: [["Substituição de ecrã", "HARDWARE", 120]], parts: [["Ecrã iPhone 14", "SCREEN", 109.9, 1]], payMethod: "MB_WAY", estDays: 1 },
  { cust: 6, device: "iPhone 11", problem: "Bateria incha, ecrã levantado", status: "DELIVERED", created: 2, delivered: 1, repairs: [["Substituição de bateria", "HARDWARE", 40]], parts: [["Bateria iPhone 12", "BATTERY", 24.9, 1]], payMethod: "CASH", estDays: 1, note: "Bateria original já deformada — descartada." },
  { cust: 7, device: "Pixel 8", problem: "Câmara traseira tremida", status: "DELIVERED", created: 1, delivered: 0, repairs: [["Substituição módulo câmara", "HARDWARE", 65]], parts: [["Câmara traseira iPhone 13", "CAMERA", 45, 1]], payMethod: "MB_WAY", estDays: 1 },
  // — done, waiting pickup —
  { cust: 8, device: "iPhone 14 Pro", problem: "Vidro traseiro estalado", status: "DONE", created: 2, repairs: [["Substituição tampa traseira", "HARDWARE", 75]], payMethod: "CASH", estDays: 1 },
  { cust: 9, device: "Galaxy A34", problem: "Coluna não emite som", status: "DONE", created: 1, repairs: [["Substituição de coluna", "HARDWARE", 30]], estDays: 1, note: "Testado — som OK nas duas saídas." },
  // — in repair —
  { cust: 0, device: "iPhone 15", problem: "Ecrã com mancha verde", status: "IN_REPAIR", created: 1, repairs: [["Substituição de ecrã", "HARDWARE", 160]], quote: { amount: 160, status: "APPROVED" }, estDays: 1, urgent: true },
  { cust: 1, device: "Redmi Note 12", problem: "Não passa do logótipo", status: "IN_REPAIR", created: 0, repairs: [["Reinstalação de firmware", "SOFTWARE", 25]], estDays: 1 },
  { cust: 2, device: "iPhone 12 mini", problem: "Microfone não capta em chamadas", status: "IN_REPAIR", created: 0, repairs: [["Substituição de microfone", "HARDWARE", 35]], deposit: 15, estDays: 2 },
  // — waiting for parts —
  { cust: 3, device: "Galaxy Z Flip5", problem: "Ecrã partido, tátil falha no topo", status: "WAITING_FOR_PARTS", created: 2, repairs: [["Substituição de ecrã", "HARDWARE", 140]], quote: { amount: 140, status: "APPROVED" }, waiting: "Ecrã Samsung Galaxy S23", estDays: 4 },
  { cust: 4, device: "Huawei P40", problem: "Bateria gasta em 3 horas", status: "WAITING_FOR_PARTS", created: 3, repairs: [["Substituição de bateria", "HARDWARE", 35]], waiting: "Bateria Huawei P30", estDays: 5 },
  // — on hold, quote awaiting customer answer —
  { cust: 5, device: "iPhone 13 mini", problem: "Caiu ao chão, ecrã preto mas toca", status: "ON_HOLD", created: 1, repairs: [], quote: { amount: 110, status: "SENT", note: "Ecrã OLED + mão de obra" }, estDays: 3 },
  // — fresh intakes today —
  { cust: 6, device: "Galaxy A54", problem: "Ecrã partido, ainda funciona", status: "INTAKE", created: 0, repairs: [], estDays: 2, urgent: true },
  { cust: 7, device: "iPhone SE (2022)", problem: "Botão home não responde", status: "INTAKE", created: 0, repairs: [], estDays: 3 },
];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!admin) {
    throw new Error("no OWNER user found");
  }

  // cleanup previous demo set
  const prevCustomers = await prisma.customer.findMany({
    where: { phone: { in: CUSTOMERS.map((c) => c.phone) } },
    select: { id: true },
  });
  const custIds = prevCustomers.map((c) => c.id);
  if (custIds.length > 0) {
    const jobIds = (
      await prisma.job.findMany({ where: { customerId: { in: custIds } }, select: { id: true } })
    ).map((j) => j.id);
    const saleIds = (
      await prisma.sale.findMany({ where: { customerId: { in: custIds } }, select: { id: true } })
    ).map((s) => s.id);
    await prisma.notificationOutbox.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.inAppNotification.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.auditLog.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.payment.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobQuote.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobNote.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobPart.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobPartsWaiting.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobRepair.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.salePayment.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
  }
  await prisma.partsCatalog.deleteMany({ where: { name: { in: PARTS.map((p) => p.name) } } });

  const customers = await Promise.all(
    CUSTOMERS.map((c) => prisma.customer.create({ data: c }))
  );
  const parts = new Map<string, { id: string }>();
  for (const p of PARTS) {
    const row = await prisma.partsCatalog.create({
      data: {
        name: p.name,
        category: p.category as never,
        defaultPrice: p.price,
        stockQuantity: p.stock,
        reorderLevel: p.reorder,
      },
    });
    parts.set(p.name, row);
  }

  const devices = await prisma.device.findMany({ include: { brand: true } });
  const findDevice = (hint: string) =>
    devices.find((d) => d.model.toLowerCase().includes(hint.toLowerCase())) ??
    devices.find((d) => hint.toLowerCase().includes(d.model.toLowerCase()));

  let created = 0;
  for (const j of JOBS) {
    const device = findDevice(j.device);
    if (!device) {
      console.log(`  ! device not found for "${j.device}" — skipping`);
      continue;
    }
    const { jobCode, accessCode } = await generateJobCode(prisma);
    const createdAt = daysAgo(j.created, j.created === 0 ? 9 + Math.floor(Math.random() * 4) : 12);
    const job = await prisma.job.create({
      data: {
        jobCode,
        accessCode,
        customerId: customers[j.cust].id,
        deviceId: device.id,
        reportedProblem: j.problem,
        status: j.status as never,
        isUrgent: j.urgent ?? false,
        estimatedCost: j.repairs.reduce((s, r) => s + r[2], 0) + (j.parts?.reduce((s, p) => s + p[2] * p[3], 0) ?? 0) || j.quote?.amount || null,
        depositAmount: j.deposit ?? null,
        estimatedDate: daysAgo(j.created - j.estDays, 18),
        createdAt,
        createdById: admin.id,
        technicianId: admin.id,
      },
    });
    created++;
    await prisma.auditLog.create({
      data: { jobId: job.id, userId: admin.id, action: "JOB_CREATED", toValue: "INTAKE", createdAt },
    });
    for (const [name, category, price] of j.repairs) {
      await prisma.jobRepair.create({
        data: { jobId: job.id, repairName: name, category: category as never, price, createdById: admin.id },
      });
    }
    for (const [name, category, unitPrice, qty] of j.parts ?? []) {
      const part = parts.get(name);
      await prisma.jobPart.create({
        data: {
          jobId: job.id,
          partId: part?.id ?? null,
          partName: name,
          category: category as never,
          unitPrice,
          quantity: qty,
          totalCost: unitPrice * qty,
          createdById: admin.id,
        },
      });
    }
    if (j.waiting) {
      await prisma.jobPartsWaiting.create({
        data: { jobId: job.id, partName: j.waiting, supplier: "Peças Telecom Lda" },
      });
    }
    if (j.quote) {
      await prisma.jobQuote.create({
        data: {
          jobId: job.id,
          version: 1,
          amount: j.quote.amount,
          note: j.quote.note,
          status: j.quote.status as never,
          sentAt: daysAgo(Math.max(j.created - 1, 0), 14),
          respondedAt: j.quote.status === "SENT" ? null : daysAgo(Math.max(j.created - 1, 0), 17),
        },
      });
    }
    if (j.note) {
      await prisma.jobNote.create({
        data: { jobId: job.id, content: j.note, isCustomerVisible: false, createdById: admin.id },
      });
    }
    if (j.delivered !== undefined) {
      const deliveredAt = daysAgo(j.delivered, 17 + Math.floor(Math.random() * 2));
      const total = j.repairs.reduce((s, r) => s + r[2], 0) + (j.parts?.reduce((s, p) => s + p[2] * p[3], 0) ?? 0);
      await prisma.auditLog.create({
        data: { jobId: job.id, userId: admin.id, action: "STATUS_CHANGED", fromValue: "DONE", toValue: "DELIVERED", createdAt: deliveredAt },
      });
      await prisma.payment.create({
        data: { jobId: job.id, method: j.payMethod as never, amount: total, createdById: admin.id, createdAt: deliveredAt },
      });
      await prisma.$executeRaw`UPDATE jobs SET "updatedAt" = ${deliveredAt} WHERE id = ${job.id}`;
    }
  }

  // POS sales — small accessories, spread over the week
  const SALE_ITEMS: Array<[number, number, Array<[string, string, number, number]>, string]> = [
    [8, 6, [["Película vidro temperado", "OTHER", 9.9, 1], ["Capa silicone iPhone 14", "OTHER", 14.9, 1]], "MB_WAY"],
    [5, 4, [["Carregador 20W USB-C", "OTHER", 19.9, 1]], "CASH"],
    [1, 2, [["Película vidro temperado", "OTHER", 9.9, 2]], "CARD"],
    [3, 0, [["Capa silicone iPhone 14", "OTHER", 14.9, 1]], "MB_WAY"],
  ];
  for (const [cust, ago, items, method] of SALE_ITEMS) {
    const saleCode = await generateSaleCode(prisma);
    const total = items.reduce((s, i) => s + i[2] * i[3], 0);
    const at = daysAgo(ago, 16);
    const sale = await prisma.sale.create({
      data: { saleCode, customerId: customers[cust].id, total, createdById: admin.id, createdAt: at },
    });
    for (const [name, category, price, qty] of items) {
      const part = parts.get(name);
      await prisma.saleItem.create({
        data: { saleId: sale.id, partId: part?.id ?? null, name, category: category as never, unitPrice: price, quantity: qty, lineTotal: price * qty },
      });
    }
    await prisma.salePayment.create({
      data: { saleId: sale.id, method: method as never, amount: total, createdAt: at },
    });
  }

  console.log(`demo seed ok: ${created} jobs, ${CUSTOMERS.length} customers, ${PARTS.length} parts, ${SALE_ITEMS.length} sales`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

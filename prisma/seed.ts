import { PrismaPg } from "@prisma/adapter-pg";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { PrismaClient } from "../generated/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "FRONT_DESK",
        input: false,
      },
      isActive: {
        type: "boolean",
        required: true,
        defaultValue: true,
        input: false,
      },
      mustChangePassword: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
    },
  },
  plugins: [username()],
});

const SEED_ADMIN_USERNAME = "admin";
// Default seed password — the app forces a username + password change on
// first login, so this value is only a bootstrap credential.
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "braindead";
const SEED_ADMIN_EMAIL = "admin@oficinaos.local";

async function main() {
  console.log("Seeding database...");

  const existing = await prisma.user.findUnique({
    where: { username: SEED_ADMIN_USERNAME },
  });

  if (existing) {
    console.log(`Admin user already exists: ${existing.username}`);
    console.log("Skipping admin seed. Seeding notification templates...");
    await seedNotificationTemplates();
    await seedAgentDefinitions();
    await seedRepairCatalog();
    await seedDevices();
    return;
  }

  try {
    const result = await auth.api.signUpEmail({
      body: {
        username: SEED_ADMIN_USERNAME,
        email: SEED_ADMIN_EMAIL,
        password: SEED_ADMIN_PASSWORD,
        name: "Admin",
      },
    });

    await prisma.user.update({
      where: { id: result.user.id },
      data: {
        role: "OWNER",
        mustChangePassword: true,
      },
    });

    console.log(`Admin user created: ${result.user.username}`);
    console.log(
      "Seed complete. Login with the configured password and change it on first access."
    );
  } catch (error) {
    console.error("Failed to create admin user:", error);
    process.exit(1);
  }

  await seedNotificationTemplates();
  await seedAgentDefinitions();
  await seedRepairCatalog();
  await seedDevices();
}

async function seedNotificationTemplates() {
  const templates = [
    {
      name: "job_created",
      channel: "IN_APP" as const,
      body: "New repair job created{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_done",
      channel: "IN_APP" as const,
      body: "Repair complete{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_in_repair",
      channel: "IN_APP" as const,
      body: "Repair in progress{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_waiting_parts",
      channel: "IN_APP" as const,
      body: "Waiting for parts{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_delivered",
      channel: "IN_APP" as const,
      body: "Device delivered{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_on_hold",
      channel: "IN_APP" as const,
      body: "Job on hold{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_returned",
      channel: "IN_APP" as const,
      body: "Device returned{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_cancelled",
      channel: "IN_APP" as const,
      body: "Job cancelled{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_overdue",
      channel: "IN_APP" as const,
      body: "Job overdue{{if jobCode}} — {{jobCode}}{{endif}}",
      isDefault: true,
    },
    {
      name: "warranty_return_created",
      channel: "IN_APP" as const,
      body: "Warranty return created{{if jobCode}} — {{jobCode}}{{endif}}",
      isDefault: true,
    },
    {
      name: "return_claim_resolved",
      channel: "IN_APP" as const,
      body: "Return claim resolved for job {{jobCode}}: {{outcome}}",
      isDefault: true,
    },
    {
      name: "job_created",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your repair {{jobCode}} has been registered at {{shopName}}. You can track it at {{shopName}}/tracking/{{jobCode}}",
      isDefault: true,
    },
    {
      name: "job_done",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your device {{jobCode}} repair is complete and ready for pickup at {{shopName}}.",
      isDefault: true,
    },
    {
      name: "job_in_repair",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your device {{jobCode}} is now being repaired at {{shopName}}.",
      isDefault: true,
    },
    {
      name: "job_waiting_parts",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, we are waiting for parts for your device {{jobCode}} at {{shopName}}.",
      isDefault: true,
    },
    {
      name: "job_delivered",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for choosing {{shopName}}!",
      isDefault: true,
    },
    {
      name: "job_on_hold",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your device {{jobCode}} repair has been put on hold at {{shopName}}.",
      isDefault: true,
    },
    {
      name: "job_returned",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your device {{jobCode}} has been returned at {{shopName}}.",
      isDefault: true,
    },
    {
      name: "job_cancelled",
      channel: "WHATSAPP" as const,
      body: "Hello {{customerName}}, your repair {{jobCode}} has been cancelled at {{shopName}}.",
      isDefault: true,
    },
  ];

  for (const tmpl of templates) {
    await prisma.notificationTemplate.upsert({
      where: { name_channel: { name: tmpl.name, channel: tmpl.channel } },
      create: tmpl,
      update: {},
    });
  }
  console.log("Notification templates seeded.");
}

async function seedRepairCatalog() {
  const repairs = [
    {
      name: "Screen Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 4500,
    },
    {
      name: "Battery Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 2500,
    },
    {
      name: "Charging Port Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 2000,
    },
    {
      name: "Back Glass Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 3000,
    },
    {
      name: "Camera Replacement (Rear)",
      category: "HARDWARE" as const,
      defaultPrice: 3500,
    },
    {
      name: "Front Camera Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 2500,
    },
    {
      name: "Speaker Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 1500,
    },
    {
      name: "Microphone Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 1500,
    },
    {
      name: "Motherboard Repair",
      category: "HARDWARE" as const,
      defaultPrice: 6000,
    },
    {
      name: "Housing Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 3000,
    },
    {
      name: "Button Replacement (Power/Volume)",
      category: "HARDWARE" as const,
      defaultPrice: 1500,
    },
    {
      name: "Vibrator Motor Replacement",
      category: "HARDWARE" as const,
      defaultPrice: 1200,
    },
    {
      name: "Water Damage Repair",
      category: "HARDWARE" as const,
      defaultPrice: 4000,
    },
    {
      name: "Screen Protector Installation",
      category: "HARDWARE" as const,
      defaultPrice: 500,
    },
    {
      name: "FRP Bypass / Google Account Removal",
      category: "SOFTWARE" as const,
      defaultPrice: 2000,
    },
    {
      name: "Software Update / Flash",
      category: "SOFTWARE" as const,
      defaultPrice: 1000,
    },
    {
      name: "OS Reinstall / Factory Reset",
      category: "SOFTWARE" as const,
      defaultPrice: 800,
    },
    {
      name: "Data Transfer / Backup",
      category: "SOFTWARE" as const,
      defaultPrice: 500,
    },
    {
      name: "Unlock Network / Carrier",
      category: "SOFTWARE" as const,
      defaultPrice: 1500,
    },

    {
      name: "Data Recovery",
      category: "SOFTWARE" as const,
      defaultPrice: 3000,
    },
    {
      name: "Virus / Malware Removal",
      category: "SOFTWARE" as const,
      defaultPrice: 1000,
    },
    {
      name: "Diagnostic Fee",
      category: "DIAGNOSTIC" as const,
      defaultPrice: 500,
    },
    {
      name: "Water Damage Diagnostic",
      category: "DIAGNOSTIC" as const,
      defaultPrice: 800,
    },
  ];

  for (const repair of repairs) {
    await prisma.repairCatalog.upsert({
      where: { name: repair.name },
      update: {},
      create: repair,
    });
  }
  console.log("Repair catalog seeded.");
}

async function seedAgentDefinitions() {
  const agents = [
    {
      name: "general_assistant",
      displayName: "General Assistant",
      instructions:
        "You are a helpful AI assistant for a phone repair shop called OficinaOS.\nYou have access to the shop's database and can answer questions about repairs, parts, customers, revenue, and more.\nAlways respond in the language the user writes in. Be concise and data-driven.\nWhen showing numbers, format them as currency when appropriate.",
      toolNames: ["queryDatabase", "getSchema"],
      isActive: true,
      isBuiltIn: true,
    },
    {
      name: "data_analyst",
      displayName: "Data Analyst",
      instructions:
        "You are a data analyst for a phone repair shop. You specialize in business insights, revenue analysis, and trend detection.\nAlways start by understanding the time period the user is interested in.\nUse charts-friendly formats when possible (tables with clear headers).\nRespond in the user's language.",
      toolNames: ["queryDatabase", "getSchema"],
      isActive: true,
      isBuiltIn: true,
    },
  ];

  for (const agent of agents) {
    await prisma.aiAgentDefinition.upsert({
      where: { name: agent.name },
      update: {},
      create: agent,
    });
  }
  console.log("Agent definitions seeded.");
}

async function seedDevices() {
  const brands = [
    {
      name: "Apple",
      models: [
        "iPhone 14",
        "iPhone 15",
        "iPhone 16",
        "iPhone 16 Pro Max",
        "iPhone SE",
      ],
    },
    {
      name: "Samsung",
      models: [
        "Galaxy S24",
        "Galaxy A54",
        "Galaxy A34",
        "Galaxy Z Flip5",
        "Galaxy M14",
      ],
    },
    { name: "Huawei", models: ["P40", "Nova 11", "Y9 Prime", "Mate 40"] },
    {
      name: "Xiaomi",
      models: ["Redmi 13", "Redmi Note 13 Pro", "Poco X6", "14"],
    },
    { name: "Oppo", models: ["Reno 10", "A78", "Find X5", "A58"] },
    { name: "Vivo", models: ["V29", "X100", "Y36", "V30"] },
    { name: "OnePlus", models: ["Nord CE 3", "12", "11", "Nord 3"] },
    { name: "Google", models: ["Pixel 8", "Pixel 7a", "Pixel 8 Pro"] },
  ];

  for (const { name, models } of brands) {
    const brand = await prisma.brand.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    for (const model of models) {
      await prisma.device.upsert({
        where: { brandId_model: { brandId: brand.id, model } },
        update: {},
        create: { brandId: brand.id, model },
      });
    }
  }
  console.log("Device brands and models seeded.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

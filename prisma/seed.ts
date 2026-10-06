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
// first login, so this value is only a bootstrap credential. Outside dev it
// must come from the environment so a predictable password is never seeded.
const SEED_ADMIN_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD ||
  (process.env.NODE_ENV === "production" ? "" : "braindead");
if (!SEED_ADMIN_PASSWORD) {
  throw new Error(
    "SEED_ADMIN_PASSWORD is required when NODE_ENV=production — refusing to seed the default password"
  );
}
const SEED_ADMIN_EMAIL =
  process.env.SEED_ADMIN_EMAIL?.trim() || "admin@oficinaos.local";

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
  await seedDevices();
}

/**
 * English bodies seeded by releases before the PT-PT defaults; used to
 * upgrade rows a shop never edited. Do not change — they must match the
 * old seed byte for byte.
 */
const LEGACY_EN_TEMPLATE_BODIES: Record<string, string> = {
  "job_created:IN_APP":
    "New repair job created{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_done:IN_APP":
    "Repair complete{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_in_repair:IN_APP":
    "Repair in progress{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_waiting_parts:IN_APP":
    "Waiting for parts{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_delivered:IN_APP":
    "Device delivered{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_on_hold:IN_APP":
    "Job on hold{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_returned:IN_APP":
    "Device returned{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_cancelled:IN_APP":
    "Job cancelled{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} for {{customerName}}{{endif}}",
  "job_overdue:IN_APP": "Job overdue{{if jobCode}} — {{jobCode}}{{endif}}",
  "warranty_return_created:IN_APP":
    "Warranty return created{{if jobCode}} — {{jobCode}}{{endif}}",
  "part_low_stock:IN_APP":
    "Low stock: {{partName}} — {{partQuantity}} left (reorder level: {{partReorderLevel}})",
  "return_claim_resolved:IN_APP":
    "Return claim resolved for job {{jobCode}}: {{outcome}}",
  "quote_sent:IN_APP":
    "Quote sent{{if jobCode}} — {{jobCode}}{{endif}}{{if quoteAmount}} ({{quoteAmount}} {{currency}}){{endif}}",
  "pre_check_submitted:IN_APP":
    "New pre-check request{{if requestCode}} — {{requestCode}}{{endif}}{{if customerName}} from {{customerName}}{{endif}}{{if deviceLabel}} ({{deviceLabel}}){{endif}}",
  "job_created:WHATSAPP":
    "Hello {{customerName}}, your repair {{jobCode}} has been registered. We will keep you updated at every step.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "job_done:WHATSAPP":
    "Good news, {{customerName}}! Your device {{jobCode}} is repaired and ready for pickup.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "job_in_repair:WHATSAPP":
    "Hello {{customerName}}, your device {{jobCode}} is now being repaired.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "job_waiting_parts:WHATSAPP":
    "Hello {{customerName}}, your device {{jobCode}} is waiting for parts. We will let you know as soon as they arrive.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "job_delivered:WHATSAPP":
    "Hello {{customerName}}, your device {{jobCode}} has been delivered. Thank you for trusting us!{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nYour receipt and warranty: {{trackingUrl}}{{endif}}{{if reviewUrl}}\nHappy with the repair? A quick review helps us a lot: {{reviewUrl}}{{endif}}",
  "job_on_hold:WHATSAPP":
    "Hello {{customerName}}, the repair of your device {{jobCode}} is on hold. Please contact us for details.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "job_returned:WHATSAPP":
    "Hello {{customerName}}, your device {{jobCode}} has been returned.{{if shopName}} — {{shopName}}{{endif}}",
  "job_cancelled:WHATSAPP":
    "Hello {{customerName}}, your repair {{jobCode}} has been cancelled.{{if shopName}} — {{shopName}}{{endif}}",
  "quote_sent:WHATSAPP":
    "Hello {{customerName}}, the estimate for your repair {{jobCode}} is ready: {{quoteAmount}} {{currency}}.{{if trackingUrl}}\nReview and approve it here: {{trackingUrl}}{{endif}}{{if shopName}} — {{shopName}}{{endif}}",
  "job_overdue:WHATSAPP":
    "Hello {{customerName}}, your repair {{jobCode}} is taking longer than expected. Our team is on it and we will update you shortly.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "warranty_return_created:WHATSAPP":
    "Hello {{customerName}}, we have registered a warranty return for your device {{jobCode}}. We will inspect it and keep you updated.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "part_low_stock:WHATSAPP":
    "Low stock alert: {{partName}} is down to {{partQuantity}} units (reorder level: {{partReorderLevel}}).{{if shopName}} — {{shopName}}{{endif}}",
};

// Default templates in PT-PT (the product's primary market). The SMS
// channel falls back to the WhatsApp body when no SMS template exists.
async function seedNotificationTemplates() {
  const templates = [
    {
      name: "job_created",
      channel: "IN_APP" as const,
      body: "Nova reparação registada{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} para {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_done",
      channel: "IN_APP" as const,
      body: "Reparação concluída{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_in_repair",
      channel: "IN_APP" as const,
      body: "Reparação em curso{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_waiting_parts",
      channel: "IN_APP" as const,
      body: "A aguardar peças{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_delivered",
      channel: "IN_APP" as const,
      body: "Aparelho entregue{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} a {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_on_hold",
      channel: "IN_APP" as const,
      body: "Reparação em pausa{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_returned",
      channel: "IN_APP" as const,
      body: "Aparelho devolvido{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} a {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_cancelled",
      channel: "IN_APP" as const,
      body: "Reparação cancelada{{if jobCode}} — {{jobCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_overdue",
      channel: "IN_APP" as const,
      body: "Reparação em atraso{{if jobCode}} — {{jobCode}}{{endif}}",
      isDefault: true,
    },
    {
      name: "warranty_return_created",
      channel: "IN_APP" as const,
      body: "Devolução em garantia registada{{if jobCode}} — {{jobCode}}{{endif}}",
      isDefault: true,
    },
    {
      name: "part_low_stock",
      channel: "IN_APP" as const,
      body: "Stock baixo: {{partName}} — restam {{partQuantity}} (nível de encomenda: {{partReorderLevel}})",
      isDefault: true,
    },
    {
      name: "return_claim_resolved",
      channel: "IN_APP" as const,
      body: "Reclamação resolvida na reparação {{jobCode}}: {{outcome}}",
      isDefault: true,
    },
    {
      name: "quote_sent",
      channel: "IN_APP" as const,
      body: "Orçamento enviado{{if jobCode}} — {{jobCode}}{{endif}}{{if quoteAmount}} ({{quoteAmount}} {{currency}}){{endif}}",
      isDefault: true,
    },
    {
      name: "pre_check_submitted",
      channel: "IN_APP" as const,
      body: "Novo pedido de pré-diagnóstico{{if requestCode}} — {{requestCode}}{{endif}}{{if customerName}} de {{customerName}}{{endif}}{{if deviceLabel}} ({{deviceLabel}}){{endif}}",
      isDefault: true,
    },
    {
      // WHATSAPP bodies only reference vars the dispatch actually
      // provides (customerName, jobCode). shopName is rendered via the
      // renderer's {{if}} conditional because it is optional in the
      // notify context — testNotification supplies it, production
      // dispatch may not, and a bare "{{shopName}}" would leak through
      // or render as an empty gap.
      name: "job_created",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} foi registada. Vamos mantê-lo informado em cada passo.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_done",
      channel: "WHATSAPP" as const,
      body: "Boas notícias, {{customerName}}! O seu aparelho {{jobCode}} está reparado e pronto a levantar.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_in_repair",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} já está em reparação.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_waiting_parts",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} está a aguardar peças. Avisamos assim que chegarem.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_delivered",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} foi entregue. Obrigado pela confiança!{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nRecibo e garantia: {{trackingUrl}}{{endif}}{{if reviewUrl}}\nFicou satisfeito com a reparação? Uma avaliação rápida ajuda-nos muito: {{reviewUrl}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_on_hold",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a reparação do seu aparelho {{jobCode}} está em pausa. Por favor contacte-nos para mais detalhes.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_returned",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} foi devolvido.{{if shopName}} — {{shopName}}{{endif}}",
      isDefault: true,
    },
    {
      name: "job_cancelled",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} foi cancelada.{{if shopName}} — {{shopName}}{{endif}}",
      isDefault: true,
    },
    {
      // Quote-ready notice with the deep link to approve/decline on the
      // tracking page. trackingUrl only renders when the shop configured
      // a public base URL; currency is injected centrally.
      name: "quote_sent",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o orçamento da sua reparação {{jobCode}} está pronto: {{quoteAmount}} {{currency}}.{{if trackingUrl}}\nConsulte e aprove aqui: {{trackingUrl}}{{endif}}{{if shopName}} — {{shopName}}{{endif}}",
      isDefault: true,
    },
    {
      // Delayed-job notice ("job-delayed"). The overdue scheduler sends
      // this to the customer's WhatsApp with consent gating handled by
      // the dispatch pipeline.
      name: "job_overdue",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} está a demorar mais do que o previsto. A nossa equipa está a tratar do assunto e daremos notícias em breve.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      // Customer-facing notice for warranty rework jobs. Mirrors the
      // dispatch context in POST /jobs (customerName, jobCode plus the
      // recipient phone used for consent-gated delivery); shopName is
      // optional and rendered via {{if}} (see above).
      name: "warranty_return_created",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, registámos uma devolução em garantia para o seu aparelho {{jobCode}}. Vamos analisá-lo e manteremos o contacto.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
      isDefault: true,
    },
    {
      // Owner-facing stock alert using the exact vars the low-stock
      // dispatcher provides (partName, partQuantity, partReorderLevel).
      // The WHATSAPP handler only queues messages with a recipientPhone,
      // so this channel activates once a recipient phone is included in
      // the notify context; the rendered vars stay consistent today.
      name: "part_low_stock",
      channel: "WHATSAPP" as const,
      body: "Alerta de stock baixo: {{partName}} tem apenas {{partQuantity}} unidades (nível de encomenda: {{partReorderLevel}}).{{if shopName}} — {{shopName}}{{endif}}",
      isDefault: true,
    },
  ];

  for (const tmpl of templates) {
    const key = { name: tmpl.name, channel: tmpl.channel };
    const existing = await prisma.notificationTemplate.findUnique({
      where: { name_channel: key },
    });
    if (!existing) {
      await prisma.notificationTemplate.create({ data: tmpl });
      continue;
    }
    // Earlier releases seeded these defaults in English. Upgrade a row only
    // while it still holds that untouched English body — a shop's own edits
    // are never overwritten.
    if (
      existing.body !== tmpl.body &&
      existing.body ===
        LEGACY_EN_TEMPLATE_BODIES[`${tmpl.name}:${tmpl.channel}`]
    ) {
      await prisma.notificationTemplate.update({
        where: { name_channel: key },
        data: { body: tmpl.body },
      });
    }
  }
  console.log("Notification templates seeded.");
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

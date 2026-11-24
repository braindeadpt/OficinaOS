import { PrismaPg } from "@prisma/adapter-pg";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { PrismaClient } from "../generated/client";
import { metaSafeConditionals } from "../server/services/whatsapp-templates.service.js";

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
// The admin is only seeded when SEED_ADMIN_PASSWORD is set (dev, CI, E2E).
// Real installs leave it unset: the app shows the first-run setup screen
// («Criar a sua oficina») while there are no users, so no install ships
// with a known password.
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD?.trim() ?? "";
const SEED_ADMIN_EMAIL =
  process.env.SEED_ADMIN_EMAIL?.trim() || "admin@oficinaos.local";

async function seedAdmin() {
  if (!SEED_ADMIN_PASSWORD) {
    console.log(
      "SEED_ADMIN_PASSWORD not set — skipping admin seed (the app opens the first-run setup screen while there are no users)."
    );
    return;
  }

  // Any existing user means the shop is already set up — never add a
  // second account with a known password (e.g. after the owner renamed
  // "admin" on first login, a username lookup would miss it).
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`Users already exist (${userCount}) — skipping admin seed.`);
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
      "Login with the configured password and change it on first access."
    );
  } catch (error) {
    console.error("Failed to create admin user:", error);
    process.exit(1);
  }
}

async function main() {
  console.log("Seeding database...");

  await seedAdmin();
  await seedNotificationTemplates();
  await seedAgentDefinitions();
  await seedDevices();
  console.log("Seed complete.");
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
  "job_done_reminder:IN_APP":
    "Pickup reminder sent to {{customerName}}{{if jobCode}} — {{jobCode}}{{endif}}",
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
  "job_done_reminder:WHATSAPP":
    "Hello {{customerName}}, your repair {{jobCode}} has been ready for pickup for a few days — please come collect it when convenient.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "warranty_return_created:WHATSAPP":
    "Hello {{customerName}}, we have registered a warranty return for your device {{jobCode}}. We will inspect it and keep you updated.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nTrack it here: {{trackingUrl}}{{endif}}",
  "part_low_stock:WHATSAPP":
    "Low stock alert: {{partName}} is down to {{partQuantity}} units (reorder level: {{partReorderLevel}}).{{if shopName}} — {{shopName}}{{endif}}",
  "signature_link:IN_APP":
    "Signature link sent to {{customerName}}{{if jobCode}} — {{jobCode}}{{endif}}",
  "signature_link:WHATSAPP":
    "Hello {{customerName}}, please review and sign {{docLabel}}{{if jobCode}} for repair {{jobCode}}{{endif}}: {{signUrl}} (valid for {{ttlMinutes}} min).{{if shopName}} — {{shopName}}{{endif}}",
};

/**
 * PT-PT bodies seeded before the Meta-compatibility fix — the trailing
 * conditional blocks closed in a bare variable, which the Meta rejects
 * ("body can't end in a parameter"). Only WHATSAPP keys: IN_APP bodies
 * were unchanged and the current PT body is the target. A row still
 * holding one of these byte-for-byte is an untouched default — the seed
 * upgrades it to the corrected body; shop edits never match.
 */
const LEGACY_PT_TEMPLATE_BODIES: Record<string, string> = {
  "job_created:WHATSAPP":
    "Olá {{customerName}}, a sua reparação {{jobCode}} foi registada. Vamos mantê-lo informado em cada passo.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "job_done:WHATSAPP":
    "Boas notícias, {{customerName}}! O seu aparelho {{jobCode}} está reparado e pronto a levantar.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "job_in_repair:WHATSAPP":
    "Olá {{customerName}}, o seu aparelho {{jobCode}} já está em reparação.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "job_waiting_parts:WHATSAPP":
    "Olá {{customerName}}, o seu aparelho {{jobCode}} está a aguardar peças. Avisamos assim que chegarem.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "job_delivered:WHATSAPP":
    "Olá {{customerName}}, o seu aparelho {{jobCode}} foi entregue. Obrigado pela confiança!{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nRecibo e garantia: {{trackingUrl}}{{endif}}{{if reviewUrl}}\nFicou satisfeito com a reparação? Uma avaliação rápida ajuda-nos muito: {{reviewUrl}}{{endif}}",
  "job_on_hold:WHATSAPP":
    "Olá {{customerName}}, a reparação do seu aparelho {{jobCode}} está em pausa. Por favor contacte-nos para mais detalhes.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "job_returned:WHATSAPP":
    "Olá {{customerName}}, o seu aparelho {{jobCode}} foi devolvido.{{if shopName}} — {{shopName}}{{endif}}",
  "job_cancelled:WHATSAPP":
    "Olá {{customerName}}, a sua reparação {{jobCode}} foi cancelada.{{if shopName}} — {{shopName}}{{endif}}",
  "quote_sent:WHATSAPP":
    "Olá {{customerName}}, o orçamento da sua reparação {{jobCode}} está pronto: {{quoteAmount}} {{currency}}.{{if trackingUrl}}\nConsulte e aprove aqui: {{trackingUrl}}{{endif}}{{if shopName}} — {{shopName}}{{endif}}",
  "job_overdue:WHATSAPP":
    "Olá {{customerName}}, a sua reparação {{jobCode}} está a demorar mais do que o previsto. A nossa equipa está a tratar do assunto e daremos notícias em breve.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "job_done_reminder:WHATSAPP":
    "Olá {{customerName}}, a sua reparação {{jobCode}} está pronta a levantar há alguns dias — passe na loja quando lhe for conveniente.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "warranty_return_created:WHATSAPP":
    "Olá {{customerName}}, registámos uma devolução em garantia para o seu aparelho {{jobCode}}. Vamos analisá-lo e manteremos o contacto.{{if shopName}} — {{shopName}}{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}{{endif}}",
  "part_low_stock:WHATSAPP":
    "Alerta de stock baixo: {{partName}} tem apenas {{partQuantity}} unidades (nível de encomenda: {{partReorderLevel}}).{{if shopName}} — {{shopName}}{{endif}}",
  "signature_link:WHATSAPP":
    "Olá {{customerName}}, por favor reveja e assine {{docLabel}}{{if jobCode}} da reparação {{jobCode}}{{endif}}: {{signUrl}} (válido durante {{ttlMinutes}} min).{{if shopName}} — {{shopName}}{{endif}}",
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
      name: "job_done_reminder",
      channel: "IN_APP" as const,
      body: "Lembrete de levantamento enviado a {{customerName}}{{if jobCode}} — {{jobCode}}{{endif}}",
      isDefault: true,
    },
    {
      // Uncollected-repair nudge ("come pick it up"). The pickup-reminder
      // scheduler sends this to the customer's WhatsApp after the job has
      // sat DONE for days; consent gating is handled by the dispatch
      // pipeline like every other automatic event.
      name: "job_done_reminder",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} está pronta a levantar há alguns dias — passe na loja quando lhe for conveniente.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
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
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} foi registada. Vamos mantê-lo informado em cada passo.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_done",
      channel: "WHATSAPP" as const,
      body: "Boas notícias, {{customerName}}! O seu aparelho {{jobCode}} está reparado e pronto a levantar.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_in_repair",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} já está em reparação.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_waiting_parts",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} está a aguardar peças. Avisamos assim que chegarem.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_delivered",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} foi entregue. Obrigado pela confiança!{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nRecibo e garantia: {{trackingUrl}}.{{endif}}{{if reviewUrl}}\nFicou satisfeito com a reparação? Uma avaliação rápida ajuda-nos muito: {{reviewUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_on_hold",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a reparação do seu aparelho {{jobCode}} está em pausa. Por favor contacte-nos para mais detalhes.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_returned",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o seu aparelho {{jobCode}} foi devolvido.{{if shopName}} — {{shopName}}.{{endif}}",
      isDefault: true,
    },
    {
      name: "job_cancelled",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} foi cancelada.{{if shopName}} — {{shopName}}.{{endif}}",
      isDefault: true,
    },
    {
      // Quote-ready notice with the deep link to approve/decline on the
      // tracking page. trackingUrl only renders when the shop configured
      // a public base URL; currency is injected centrally.
      name: "quote_sent",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, o orçamento da sua reparação {{jobCode}} está pronto: {{quoteAmount}} {{currency}}.{{if trackingUrl}}\nConsulte e aprove aqui: {{trackingUrl}}.{{endif}}{{if shopName}} — {{shopName}}.{{endif}}",
      isDefault: true,
    },
    {
      // Delayed-job notice ("job-delayed"). The overdue scheduler sends
      // this to the customer's WhatsApp with consent gating handled by
      // the dispatch pipeline.
      name: "job_overdue",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, a sua reparação {{jobCode}} está a demorar mais do que o previsto. A nossa equipa está a tratar do assunto e daremos notícias em breve.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
      isDefault: true,
    },
    {
      // Customer-facing notice for warranty rework jobs. Mirrors the
      // dispatch context in POST /jobs (customerName, jobCode plus the
      // recipient phone used for consent-gated delivery); shopName is
      // optional and rendered via {{if}} (see above).
      name: "warranty_return_created",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, registámos uma devolução em garantia para o seu aparelho {{jobCode}}. Vamos analisá-lo e manteremos o contacto.{{if shopName}} — {{shopName}}.{{endif}}{{if trackingUrl}}\nAcompanhe aqui: {{trackingUrl}}.{{endif}}",
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
      body: "Alerta de stock baixo: {{partName}} tem apenas {{partQuantity}} unidades (nível de encomenda: {{partReorderLevel}}).{{if shopName}} — {{shopName}}.{{endif}}",
      isDefault: true,
    },
    {
      // Staff-initiated signing link (intake ficha or loaner term) — the
      // docLabel var is localized server-side from the frozen document.
      name: "signature_link",
      channel: "IN_APP" as const,
      body: "Link de assinatura enviado a {{customerName}}{{if jobCode}} — {{jobCode}}{{endif}}",
      isDefault: true,
    },
    {
      name: "signature_link",
      channel: "WHATSAPP" as const,
      body: "Olá {{customerName}}, por favor reveja e assine {{docLabel}}{{if jobCode}} da reparação {{jobCode}}{{endif}}: {{signUrl}} (válido durante {{ttlMinutes}} min).{{if shopName}} — {{shopName}}.{{endif}}",
      isDefault: true,
    },
    {
      // Livro de ponto (Pro "ponto") — lembrete de saída business-initiated
      // ao funcionário. Sai como template Meta aprovado (fora da janela de
      // 24 h); {{exitTime}} é a hora configurada em pontoExitReminderTime.
      // O lembrete em si é enviado diretamente pelo scheduler do ponto —
      // não passa pelo notify()/outbox (o destinatário é staff, não cliente).
      name: "ponto_lembrete",
      channel: "WHATSAPP" as const,
      body: "OficinaOS: ainda não tem saída registada. Saiu às {{exitTime}}? Responda SIM ou indique a hora.",
      isDefault: true,
    },
    {
      // Livro de ponto — alerta ao gestor quando o funcionário não
      // respondeu ao lembrete de saída (>60 min sem correção). IN_APP
      // apenas: chega pela central de notificações + websocket.
      name: "ponto_saida_pendente",
      channel: "IN_APP" as const,
      body: "Livro de ponto: {{workerName}} não confirmou a saída das {{exitTime}} — registo presumido por validar.",
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
    // Earlier releases seeded these defaults in English, and the PT-PT
    // WhatsApp bodies once closed their trailing conditional blocks in a
    // bare variable — a shape Meta rejects ("body can't end in a
    // parameter"). Upgrade a row only while it still holds an untouched
    // default: an old EN/PT literal or its migration-fixed variant
    // (metaSafeConditionals inserts "." inside the trailing endif — the
    // DB migration produces exactly that for rows already installed).
    // A shop's own edits never match and are never overwritten.
    const key0 = `${tmpl.name}:${tmpl.channel}`;
    const untouched = [
      LEGACY_EN_TEMPLATE_BODIES[key0],
      LEGACY_PT_TEMPLATE_BODIES[key0],
    ].some(
      (b) =>
        b !== undefined &&
        (existing.body === b || existing.body === metaSafeConditionals(b))
    );
    if (existing.body !== tmpl.body && untouched) {
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

const deviceCatalog = (
  await import("../shared/device-catalog.json", { with: { type: "json" } })
).default as {
  brands: { models: { category: string; model: string }[]; name: string }[];
};

async function seedDevices() {
  // Case-insensitive brand matching — see device-catalog.service.ts: older
  // seeds created "Vivo" while the catalog says "vivo".
  const existingBrands = await prisma.brand.findMany({
    select: { id: true, name: true },
  });
  const brandsByLower = new Map(
    existingBrands.map((b) => [b.name.toLowerCase(), b])
  );
  for (const { name, models } of deviceCatalog.brands) {
    let brand = brandsByLower.get(name.toLowerCase());
    if (!brand) {
      brand = await prisma.brand.create({ data: { name } });
      brandsByLower.set(name.toLowerCase(), brand);
    }
    const existing = await prisma.device.findMany({
      select: { category: true, id: true, model: true },
      where: { brandId: brand.id },
    });
    const byModel = new Map(existing.map((d) => [d.model, d]));
    const toCreate: {
      brandId: string;
      category: string;
      model: string;
    }[] = [];
    for (const { category, model } of models) {
      const ex = byModel.get(model);
      if (!ex) {
        toCreate.push({ brandId: brand.id, category, model });
      } else if (ex.category !== category) {
        await prisma.device.update({
          data: { category },
          where: { id: ex.id },
        });
      }
    }
    if (toCreate.length > 0) {
      await prisma.device.createMany({ data: toCreate });
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

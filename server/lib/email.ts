import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";
import { loadEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { assertNotDemoMode } from "./demo.js";

let _transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  const env = loadEnv();
  return Boolean(
    env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS
  );
}

function getTransporter(): Transporter {
  if (!_transporter) {
    const env = loadEnv();
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_PORT === 465,
      // Never let a dead SMTP server hang a request past Fastify's own
      // 30s request timeout.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<void> {
  assertNotDemoMode();
  if (!isEmailConfigured()) {
    logger.warn(
      "[email] SMTP not configured — skipping email send. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to enable."
    );
    return;
  }

  const env = loadEnv();
  const from = env.EMAIL_FROM || `"OficinaOS" <noreply@oficinaos.com>`;

  await getTransporter().sendMail({ from, to, subject, text, html });
}

const RESET_EMAIL_COPY: Record<
  string,
  {
    subject: string;
    title: string;
    intro: string;
    button: string;
    expiry: string;
    ignore: string;
  }
> = {
  pt: {
    subject: "Repor a password do OficinaOS",
    title: "Repor a password",
    intro: "Clique no botão abaixo para definir uma nova password:",
    button: "Repor password",
    expiry: "Este link é válido durante 1 hora.",
    ignore: "Se não pediu isto, ignore este email.",
  },
  en: {
    subject: "Reset your OficinaOS password",
    title: "Reset your password",
    intro: "Click the button below to set a new password:",
    button: "Reset Password",
    expiry: "This link is valid for 1 hour.",
    ignore: "If you didn't request this, you can ignore this email.",
  },
  es: {
    subject: "Restablecer la contraseña de OficinaOS",
    title: "Restablecer la contraseña",
    intro: "Haga clic en el botón para definir una nueva contraseña:",
    button: "Restablecer contraseña",
    expiry: "Este enlace es válido durante 1 hora.",
    ignore: "Si no lo ha solicitado, ignore este correo.",
  },
  fr: {
    subject: "Réinitialiser votre mot de passe OficinaOS",
    title: "Réinitialiser le mot de passe",
    intro:
      "Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :",
    button: "Réinitialiser",
    expiry: "Ce lien est valable pendant 1 heure.",
    ignore:
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  },
};

export function buildPasswordResetEmail(
  resetUrl: string,
  locale = "pt"
): { subject: string; text: string; html: string } {
  const copy = RESET_EMAIL_COPY[locale] ?? RESET_EMAIL_COPY.pt;
  const safeUrl = resetUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return {
    subject: copy.subject,
    text: `${copy.intro}\n\n${resetUrl}\n\n${copy.expiry}\n${copy.ignore}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <p style="margin:0 0 16px;font-size:20px;font-weight:800;letter-spacing:-0.3px;color:#111827">Oficina<span style="color:#1d4ed8">OS</span></p>
        <h2 style="color:#1a1a1a">${copy.title}</h2>
        <p>${copy.intro}</p>
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${copy.button}</a>
        <p style="margin-top:16px;color:#666;font-size:14px">${copy.expiry} ${copy.ignore}</p>
      </div>
    `,
  };
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  locale = "pt"
): Promise<void> {
  const { subject, text, html } = buildPasswordResetEmail(resetUrl, locale);
  await sendEmail({ to, subject, text, html });
}

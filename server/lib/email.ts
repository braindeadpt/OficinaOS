import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";
import { loadEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

let _transporter: Transporter | null = null;

function isConfigured(): boolean {
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
  if (!isConfigured()) {
    logger.warn(
      "[email] SMTP not configured — skipping email send. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to enable."
    );
    return;
  }

  const env = loadEnv();
  const from = env.EMAIL_FROM || `"OficinaOS" <noreply@oficinaos.com>`;

  await getTransporter().sendMail({ from, to, subject, text, html });
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<void> {
  const safeUrl = resetUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  await sendEmail({
    to,
    subject: "Reset your OficinaOS password",
    text: `Click the link below to reset your password:\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1a1a1a">Reset your password</h2>
        <p>Click the button below to set a new password:</p>
        <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#6750a4;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
        <p style="margin-top:16px;color:#666;font-size:14px">If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

import { AppError } from "@shared/errors/app-error.js";
import type { ReportProblemInput } from "@shared/schemas/feedback.schema";
import pkg from "../../package.json";
import { loadEnv } from "../config/env.js";

const GITHUB_API = "https://api.github.com";
const USER_REPORT_LABEL = "user-report";
const TITLE_MAX = 80;

export interface FeedbackReporter {
  name: string;
  username: string;
}

export interface FeedbackResult {
  issueNumber: number;
  issueUrl: string;
}

// The "user-report" label is created on first use — remember it so we don't
// pay the extra round-trip on every report.
let labelEnsured = false;

function buildTitle(description: string): string {
  const firstLine = description.split("\n")[0].trim();
  const summary =
    firstLine.length > TITLE_MAX
      ? `${firstLine.slice(0, TITLE_MAX - 1)}…`
      : firstLine;
  return `[User report] ${summary}`;
}

function buildIssueBody(
  input: ReportProblemInput,
  reporter: FeedbackReporter
): string {
  const ctx = input.context;
  const errorLog =
    ctx?.errors && ctx.errors.length > 0
      ? ctx.errors.map((e) => `- ${e}`).join("\n")
      : "_None captured._";
  return [
    `> Reported in-app by **${reporter.name}** (\`${reporter.username}\`)`,
    "",
    "## Description",
    input.description,
    "",
    "## Contact",
    input.contact || "_Not provided_",
    "",
    "## Context",
    `- App version: ${pkg.version}`,
    `- Page: ${ctx?.url ?? "unknown"}`,
    `- Locale: ${ctx?.locale ?? "unknown"}`,
    `- User agent: ${ctx?.userAgent ?? "unknown"}`,
    `- Reported at: ${new Date().toISOString()}`,
    "",
    "## Recent client errors",
    errorLog,
    "",
    "---",
    "_Created automatically from in-app feedback._",
  ].join("\n");
}

async function ensureUserReportLabel(
  repo: string,
  headers: Record<string, string>
): Promise<void> {
  if (labelEnsured) {
    return;
  }
  // 422 means the label already exists — that's the happy path too.
  const res = await fetch(`${GITHUB_API}/repos/${repo}/labels`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: USER_REPORT_LABEL,
      color: "fb8c00",
      description: "Reported by a user from inside the app",
    }),
  });
  if (res.ok || res.status === 422) {
    labelEnsured = true;
  }
}

export async function submitFeedbackReport(
  input: ReportProblemInput,
  reporter: FeedbackReporter
): Promise<FeedbackResult> {
  const env = loadEnv();
  if (!env.GITHUB_FEEDBACK_TOKEN) {
    throw new AppError("FEEDBACK_NOT_CONFIGURED");
  }
  const repo = env.GITHUB_FEEDBACK_REPO;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_FEEDBACK_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "OficinaOS-feedback",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  await ensureUserReportLabel(repo, headers);

  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: buildTitle(input.description),
      body: buildIssueBody(input, reporter),
      labels: ["bug", USER_REPORT_LABEL],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError("FEEDBACK_FAILED", {
      status: res.status,
      detail: detail.slice(0, 300),
    });
  }
  const data = (await res.json()) as { number: number; html_url: string };
  return { issueNumber: data.number, issueUrl: data.html_url };
}

/** Test-only: re-arm the label creation probe. */
export function __resetFeedbackLabelCache(): void {
  labelEnsured = false;
}

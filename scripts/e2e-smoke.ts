/**
 * E2E smoke: login → intake (create job) → INTAKE→IN_REPAIR→DONE against a
 * running docker compose deployment. Runs in CI; pure HTTP, no browser.
 *
 *   BASE_URL=http://oficinaos.test:4000 SEED_ADMIN_PASSWORD=… bun scripts/e2e-smoke.ts
 */

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4000").replace(
  /\/$/,
  ""
);
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD?.trim();
// The seeded admin is flagged mustChangePassword — rotate once on login so
// the session can call the rest of the API. Must satisfy the password
// policy (≥8 chars, lower+upper+digit).
const NEW_PASSWORD = "SmokeE2e-passw0rd";

if (!ADMIN_PASSWORD) {
  console.error("SEED_ADMIN_PASSWORD must be set");
  process.exit(1);
}

const cookies = new Map<string, string>();
let csrfToken = "";

function storeCookies(res: Response) {
  for (const header of res.headers.getSetCookie()) {
    const [nameValue] = header.split(";");
    const eq = nameValue.indexOf("=");
    if (eq > 0) {
      cookies.set(nameValue.slice(0, eq).trim(), nameValue.slice(eq + 1).trim());
    }
  }
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = {
    Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    Origin: BASE_URL,
  };
  if (json) {
    h["Content-Type"] = "application/json";
  }
  if (csrfToken) {
    h["X-CSRF-Token"] = csrfToken;
  }
  return h;
}

async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  storeCookies(res);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON response (e.g. the SPA shell) — keep the raw text
  }
  return { status: res.status, data };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(step: string, status: number, data: unknown): never {
  throw new Error(`${step} failed: ${status} — ${JSON.stringify(data)}`);
}

async function waitHealthy(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // app not up yet
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for /health");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  await waitHealthy();
  console.log("✓ /health ok");

  const csrf = await request("GET", "/api/csrf-token");
  csrfToken =
    typeof csrf.data === "object" && csrf.data !== null
      ? ((csrf.data as { token?: string }).token ?? "")
      : "";
  assert(csrf.status === 200 && csrfToken, "No CSRF token");
  console.log("✓ csrf token");

  const login = await request("POST", "/api/auth/sign-in/username", {
    username: "admin",
    password: ADMIN_PASSWORD,
  });
  if (login.status !== 200) {
    fail("login", login.status, login.data);
  }
  const session = await request("GET", "/api/auth/get-session");
  assert(
    session.status === 200 &&
      typeof session.data === "object" &&
      session.data !== null &&
      "user" in session.data,
    `get-session failed: ${session.status}`
  );
  const changePassword = await request("POST", "/api/auth/change-password", {
    oldPassword: ADMIN_PASSWORD,
    newPassword: NEW_PASSWORD,
  });
  if (changePassword.status !== 200) {
    fail("change-password", changePassword.status, changePassword.data);
  }
  console.log("✓ login (+ forced password rotation)");

  const intake = await request("POST", "/api/jobs", {
    customerName: "E2E Smoke Cliente",
    customerPhone: "+351912345678",
    deviceBrand: "Apple",
    deviceModel: "iPhone 13",
    reportedProblem: "Smoke e2e: ecrã partido",
    repairs: [
      {
        repairName: "Substituição de ecrã",
        category: "HARDWARE",
        price: 89.9,
      },
    ],
  });
  if (intake.status !== 201 && intake.status !== 200) {
    fail("intake", intake.status, intake.data);
  }
  const job = intake.data as { id?: string; status?: string };
  assert(job.id, `intake response has no id: ${JSON.stringify(intake.data)}`);
  assert(job.status === "INTAKE", `intake status is ${job.status}`);
  console.log(`✓ intake (job ${job.id})`);

  const inRepair = await request("PATCH", `/api/jobs/${job.id}/status`, {
    status: "IN_REPAIR",
  });
  if (inRepair.status !== 200) {
    fail("INTAKE→IN_REPAIR", inRepair.status, inRepair.data);
  }
  const done = await request("PATCH", `/api/jobs/${job.id}/status`, {
    status: "DONE",
    actualLaborHours: 1,
    qcChecklist: {
      powersOn: "ok",
      screen: "ok",
      touch: "ok",
      cameras: "ok",
      audio: "ok",
      charging: "ok",
    },
  });
  if (done.status !== 200) {
    fail("IN_REPAIR→DONE", done.status, done.data);
  }

  const check = await request("GET", `/api/jobs/${job.id}`);
  const final = check.data as { status?: string };
  assert(
    check.status === 200 && final.status === "DONE",
    `job status is ${final.status} (${check.status})`
  );
  console.log(`✓ DONE (job ${job.id})`);
  console.log("E2E smoke: PASS");
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

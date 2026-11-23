import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import { cleanupInboxRetention } from "../services/inbox.service.js";
import { runStaffInboxTool } from "../services/staff-inbox-tools.js";
import { isModuleEnabled } from "../utils/modules.js";

/**
 * Ligação permanente app→Cloud (§G.6, "link 2b").
 *
 * A app abre um GET /ai-inbox/link (SSE) autenticado com o shop token
 * cifrado e espera chamadas de ferramenta:
 *   Cloud → app : {callId, tool, args, userId}
 *   app → Cloud : POST /ai-inbox/link/respond {callId,result} |
 *                 {callId,error}
 * Cada chamada corre com as permissões do userId fornecido e tem um
 * timeout de 10 s — passado esse tempo responde-se {callId,error} e a
 * Cloud nunca fica à espera.
 *
 * Sem portas inbound: é a app que liga de fora para dentro. Reconnect
 * com backoff exponencial (1 s → 60 s + jitter); quando o entitlement
 * "ai-inbox" cai (ou a loja desemparelha), a ligação fecha e não volta
 * a abrir — o módulo é gateado pela verificação Cloud, não por flag
 * local.
 */

const SUPERVISOR_MS = 20_000;
const CALL_TIMEOUT_MS = 10_000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
// Retenção da inbox: corre na cadência do supervisor (dedup interno por
// janela — a sweep propriamente dita só roda 1×/dia).
const RETENTION_INTERVAL_MS = 24 * 3600 * 1000;
const TRAILING_SLASHES_RE = /\/+$/;

let stopped = false;
let supervisor: ReturnType<typeof setInterval> | null = null;
let connecting = false;
let abortCurrent: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_MIN_MS;
let lastRetentionAt = 0;

interface LinkCall {
  args?: Record<string, unknown>;
  callId?: unknown;
  tool?: unknown;
  userId?: unknown;
}

async function respond(
  apiUrl: string,
  token: string,
  callId: string,
  body: { error: string } | { result: unknown },
  log: FastifyInstance["log"]
): Promise<void> {
  const res = await cloudFetch(apiUrl, "/ai-inbox/link/respond", {
    body: { callId, ...body },
    method: "POST",
    token,
  }).catch(() => null);
  if (!res?.ok) {
    log.warn({ callId, status: res?.status }, "ai-inbox link: respond falhou");
  }
}

function nextBackoff(): number {
  const jitter = Math.random() * 0.3 * backoffMs;
  const out = Math.min(backoffMs + jitter, BACKOFF_MAX_MS);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  return out;
}

/** Timeout duro de 10 s por chamada — contrato §G.6. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

async function handleCall(
  app: FastifyInstance,
  apiUrl: string,
  token: string,
  raw: LinkCall
): Promise<void> {
  const callId = typeof raw.callId === "string" ? raw.callId : null;
  if (!callId) {
    return; // frame sem callId — não há a quem responder
  }
  const tool = typeof raw.tool === "string" ? raw.tool : "";
  const userId = typeof raw.userId === "string" ? raw.userId : "";
  try {
    const out = await withTimeout(
      runStaffInboxTool(app.prisma, app.log, {
        args: raw.args,
        tool,
        userId,
      }),
      CALL_TIMEOUT_MS
    );
    await respond(
      apiUrl,
      token,
      callId,
      out.error === undefined ? { result: out.result } : { error: out.error },
      app.log
    );
  } catch (err) {
    await respond(
      apiUrl,
      token,
      callId,
      {
        error:
          err instanceof Error && err.message === "timeout"
            ? "timeout"
            : "erro interno",
      },
      app.log
    );
  }
}

/** Consome um stream SSE: blocos "data: <json>" separados por \n\n. */
async function readStream(
  app: FastifyInstance,
  apiUrl: string,
  token: string,
  res: Response,
  signal: AbortSignal
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) {
        continue; // heartbeat/comentário
      }
      let parsed: LinkCall;
      try {
        parsed = JSON.parse(data) as LinkCall;
      } catch {
        app.log.warn("ai-inbox link: frame inválido ignorado");
        continue;
      }
      // Sem await — cada chamada tem o seu timeout de 10 s; o stream
      // continua a ler para a Cloud poder mandar chamadas paralelas.
      handleCall(app, apiUrl, token, parsed).catch(() => undefined);
    }
  }
}

async function connect(
  app: FastifyInstance,
  apiUrl: string,
  token: string
): Promise<void> {
  if (connecting || stopped) {
    return;
  }
  connecting = true;
  const controller = new AbortController();
  abortCurrent = controller;
  try {
    app.log.info("ai-inbox link: a ligar à Cloud");
    const res = await fetch(
      `${apiUrl.replace(TRAILING_SLASHES_RE, "")}/ai-inbox/link`,
      {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      app.log.warn({ status: res.status }, "ai-inbox link: ligação recusada");
      return;
    }
    backoffMs = BACKOFF_MIN_MS; // ligação boa → backoff reinicia
    app.log.info("ai-inbox link: ligado");
    await readStream(app, apiUrl, token, res, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) {
      app.log.warn({ err }, "ai-inbox link: ligação caiu");
    }
  } finally {
    connecting = false;
    abortCurrent = null;
    if (!stopped) {
      // A supervisor volta a chamar connect() — o delay aqui é o
      // backoff exponencial entre tentativas.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
      }, nextBackoff());
    }
  }
}

/** Só liga quando o entitlement "ai-inbox" está ativo e a loja emparelhada. */
async function tick(app: FastifyInstance): Promise<void> {
  if (stopped) {
    return;
  }
  const settings = await getOrCreateShopSettings(app.prisma).catch(() => null);
  const entitled = isModuleEnabled(settings, "ai-inbox");
  const token = settings?.cloudShopTokenEncrypted
    ? decryptSecret(settings.cloudShopTokenEncrypted)
    : null;
  const apiUrl = settings?.cloudApiUrl ?? null;
  if (!(entitled && token && apiUrl)) {
    if (abortCurrent) {
      app.log.info("ai-inbox link: entitlement caiu — a desligar");
      abortCurrent.abort();
      abortCurrent = null;
    }
    return;
  }
  // Sweep de retenção 1×/dia — corre na cadência do supervisor porque o
  // link já acorda com esta cadência e o módulo é o gate certo.
  if (Date.now() - lastRetentionAt > RETENTION_INTERVAL_MS) {
    lastRetentionAt = Date.now();
    await cleanupInboxRetention(app.prisma, app.log).catch(() => undefined);
  }
  if (!(connecting || reconnectTimer)) {
    await connect(app, apiUrl, token);
  }
}

/**
 * Supervisor: acorda a cada 20 s, liga quando o entitlement está ativo,
 * desliga quando cai. Sem efeitos no arranque se a loja não for Pro.
 */
export function startAiInboxLink(app: FastifyInstance): () => void {
  stopped = false;
  const run = () =>
    tick(app).catch((err) =>
      app.log.warn({ err }, "ai-inbox link tick falhou")
    );
  supervisor = setInterval(run, SUPERVISOR_MS);
  supervisor.unref();
  run();
  return () => {
    stopped = true;
    if (supervisor) {
      clearInterval(supervisor);
      supervisor = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    abortCurrent?.abort();
    abortCurrent = null;
  };
}

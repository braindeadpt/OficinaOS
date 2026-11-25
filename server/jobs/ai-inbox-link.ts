import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import { cleanupInboxRetention } from "../services/inbox.service.js";
import {
  canReplayStaffInboxTool,
  runStaffInboxTool,
} from "../services/staff-inbox-tools.js";
import { isModuleEnabled } from "../utils/modules.js";

/**
 * Ligação permanente app→Cloud (§G.6, "link 2b").
 *
 * A app abre um GET /ai-inbox/link (SSE) autenticado com o shop token
 * cifrado e espera chamadas de ferramenta:
 *   Cloud → app : {callId, tool, args, userId, idempotencyKey?}
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
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 200;
const IDEMPOTENCY_KEY_MAX_LEN = 128;
// Só as ferramentas com efeitos não idempotentes precisam de cache:
// marcar/atribuir são escritas de estado naturalmente repetíveis e as
// leituras não têm efeito; reter essas chaves podia confirmar uma ação
// nova (ex.: fechar depois de reabrir) sem a executar.
const IDEMPOTENT_TOOLS = new Set(["enviar_rascunho", "rascunhar_resposta"]);

type ToolOutcome = Awaited<ReturnType<typeof runStaffInboxTool>>;

interface IdempotentExecution {
  controller: AbortController;
  expiresAt: number;
  promise: Promise<ToolOutcome>;
  settled: boolean;
}

let stopped = false;
let supervisor: ReturnType<typeof setInterval> | null = null;
let connecting = false;
let abortCurrent: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = BACKOFF_MIN_MS;
let lastRetentionAt = 0;

// Chaves de idempotência da Cloud (sha256 — por isso cap de tamanho só
// defensivo). Em memória por natureza: a ligação 2b já é efémera e um
// restart da app cai no claim atómico/estado do rascunho como antes.
const idempotentCalls = new Map<string, IdempotentExecution>();

interface LinkCall {
  args?: Record<string, unknown>;
  callId?: unknown;
  idempotencyKey?: unknown;
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

/** Limpeza lazy: completadas expiram; in-flight ficam até ao cap duro. */
function pruneIdempotentCalls(): void {
  const now = Date.now();
  for (const [key, entry] of idempotentCalls) {
    if (entry.settled && entry.expiresAt <= now) {
      idempotentCalls.delete(key);
    }
  }
  while (idempotentCalls.size > IDEMPOTENCY_MAX_ENTRIES) {
    let keyToEvict: string | undefined;
    for (const [key, entry] of idempotentCalls) {
      if (entry.settled) {
        keyToEvict = key;
        break;
      }
    }
    keyToEvict ??= idempotentCalls.keys().next().value;
    if (keyToEvict === undefined) {
      break;
    }
    idempotentCalls.delete(keyToEvict);
  }
}

/**
 * Arranca (ou reutiliza) a execução da chamada. A promise guardada é a
 * execução real — não o race do timeout — porque uma chamada que já
 * respondeu timeout pode ainda assim terminar e ser replayed ao retry.
 */
async function executionFor(
  app: FastifyInstance,
  raw: LinkCall,
  tool: string,
  userId: string,
  idempotencyKey: string | null
): Promise<IdempotentExecution> {
  if (idempotencyKey) {
    pruneIdempotentCalls();
    const existing = idempotentCalls.get(idempotencyKey);
    if (existing && !existing.settled) {
      return existing;
    }
    if (existing) {
      // Replay de um resultado já concluído: revalida conta/permissão —
      // se recusar, executa de novo e o runStaffInboxTool recusa e audita.
      // Erro na consulta propaga ("erro interno") e mantém a cache: re-executar
      // aqui duplicaria operações não idempotentes (ex.: criar rascunho).
      const allowed = await canReplayStaffInboxTool(app.prisma, tool, userId);
      const current = idempotentCalls.get(idempotencyKey);
      if (current && (allowed || current !== existing)) {
        return current;
      }
      idempotentCalls.delete(idempotencyKey);
    }
  }
  const controller = new AbortController();
  const promise = runStaffInboxTool(app.prisma, app.log, {
    args: raw.args,
    signal: controller.signal,
    tool,
    userId,
  });
  const execution: IdempotentExecution = {
    controller,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    promise,
    settled: false,
  };
  const markSettled = (out?: ToolOutcome) => {
    execution.settled = true;
    execution.expiresAt = Date.now() + IDEMPOTENCY_TTL_MS;
    // Cancelado = nada foi feito (claim revertido): o retry com a mesma
    // chave tem de voltar a executar, não repetir o cancelamento.
    if (
      idempotencyKey &&
      out?.error === "cancelado" &&
      idempotentCalls.get(idempotencyKey) === execution
    ) {
      idempotentCalls.delete(idempotencyKey);
    }
  };
  promise.then(markSettled, () => markSettled());
  if (idempotencyKey) {
    idempotentCalls.set(idempotencyKey, execution);
    pruneIdempotentCalls();
  }
  return execution;
}

/** Timeout duro de 10 s por chamada — contrato §G.6. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("timeout"));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function handleCall(
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
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" &&
    raw.idempotencyKey.length > 0 &&
    raw.idempotencyKey.length <= IDEMPOTENCY_KEY_MAX_LEN &&
    IDEMPOTENT_TOOLS.has(tool)
      ? raw.idempotencyKey
      : null;
  try {
    const execution = await executionFor(
      app,
      raw,
      tool,
      userId,
      idempotencyKey
    );
    const out = await withTimeout(execution.promise, CALL_TIMEOUT_MS, () =>
      execution.controller.abort()
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

import type { FastifyPluginAsync } from "fastify";
import { getSessionFromRequest } from "../lib/auth.js";

interface WsClient {
  alive: boolean;
  role: string;
  sessionId: string;
  socket: import("ws").WebSocket;
  userId: string;
}

const connections = new Set<WsClient>();
const HEARTBEAT_MS = 30_000;

export function wsBroadcast(
  predicate: (client: WsClient) => boolean,
  payload: Record<string, unknown>
) {
  const data = JSON.stringify(payload);
  for (const client of connections) {
    if (predicate(client) && client.socket.readyState === 1) {
      client.socket.send(data);
    }
  }
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const websocketPlugin: FastifyPluginAsync = async (app) => {
  // Heartbeat + session revalidation. A client that signed out (or whose
  // session was revoked) must stop receiving broadcasts even if the socket
  // is still open — the session is only checked once at upgrade time.
  const sweepInterval = setInterval(async () => {
    let validSessions: Set<string>;
    try {
      const ids = [...connections].map((c) => c.sessionId);
      const rows = ids.length
        ? await app.prisma.session.findMany({
            where: { id: { in: ids }, expiresAt: { gt: new Date() } },
            select: { id: true },
          })
        : [];
      validSessions = new Set(rows.map((s) => s.id));
    } catch (err) {
      // DB hiccup: skip revocation checks this round, only ping below.
      app.log.warn({ err }, "WS session revalidation skipped");
      validSessions = new Set([...connections].map((c) => c.sessionId));
    }

    for (const client of connections) {
      if (!validSessions.has(client.sessionId)) {
        client.socket.close(4001, "Session expired");
        connections.delete(client);
        continue;
      }
      if (!client.alive) {
        client.socket.terminate();
        connections.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, HEARTBEAT_MS);

  app.addHook("onClose", () => {
    clearInterval(sweepInterval);
    for (const client of connections) {
      client.socket.terminate();
    }
    connections.clear();
  });

  app.get("/ws", { websocket: true }, async (socket, req) => {
    const session = await getSessionFromRequest(app.auth, req);
    if (!session) {
      app.log.warn("WS connection rejected — invalid session");
      socket.close(4001, "Unauthorized");
      return;
    }

    const client: WsClient = {
      alive: true,
      role: session.role,
      sessionId: session.sessionId,
      socket: socket as import("ws").WebSocket,
      userId: session.id,
    };

    connections.add(client);
    app.log.info(
      { role: client.role, userId: client.userId },
      "WS client connected"
    );

    const ws = socket as import("ws").WebSocket;

    ws.on("pong", () => {
      client.alive = true;
    });

    ws.on("close", () => {
      connections.delete(client);
      app.log.info("WS client disconnected");
    });

    ws.on("message", (msg: Buffer) => {
      app.log.debug(`WS message: ${msg.toString()}`);
    });
  });
};

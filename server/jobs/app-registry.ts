import type { FastifyInstance } from "fastify";

/**
 * Single-location deployment: one Fastify instance per process. Services
 * that need wsBroadcast/logger but receive only a prisma client (e.g.
 * deep inside transactions) can look the app up here instead of threading
 * it through every signature.
 */
let currentApp: FastifyInstance | null = null;

export function setAppInstance(app: FastifyInstance): void {
  currentApp = app;
}

export function getAppInstance(): FastifyInstance | null {
  return currentApp;
}

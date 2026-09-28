import pino from "pino";

export const logger = pino({
  name: "oficinaos",
  level: process.env.LOG_LEVEL ?? "info",
});

FROM oven/bun:1.4.4

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# prisma.config.ts exige DATABASE_URL existir em build-time (não liga à DB, só valida)
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" bun run build

ENV NODE_ENV=production
EXPOSE 4000

# Run as the image's non-root user; /app/uploads is the named-volume write path.
RUN mkdir -p /app/uploads && chown bun:bun /app/uploads
USER bun

CMD ["bun", "run", "start:prod"]

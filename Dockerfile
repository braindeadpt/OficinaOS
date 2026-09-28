FROM oven/bun:1.3.13

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# prisma.config.ts exige DATABASE_URL existir em build-time (não liga à DB, só valida)
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" bun run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["bun", "run", "start:prod"]

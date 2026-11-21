FROM oven/bun:1.4.4

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# prisma.config.ts exige DATABASE_URL existir em build-time (não liga à DB, só valida)
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" bun run build

ENV NODE_ENV=production
EXPOSE 4000

# /app/uploads é o write-path do named volume. O entrypoint começa como
# root para corrigir ownership de volumes criados pela imagem antiga (root)
# e só depois baixa para o utilizador não-root — `USER bun` direto partia
# uploads em instalações existentes.
RUN mkdir -p /app/uploads && chown bun:bun /app/uploads
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "start:prod"]

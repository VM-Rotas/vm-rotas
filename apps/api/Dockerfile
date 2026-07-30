FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @vm-rotas/api... --frozen-lockfile=false

COPY apps/api apps/api
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
RUN pnpm --filter @vm-rotas/api prisma:generate
RUN pnpm --filter @vm-rotas/api build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api

EXPOSE 3001
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS:-false}\" = \"true\" ]; then pnpm --filter @vm-rotas/api prisma:deploy; fi; if [ \"${RUN_SEED:-false}\" = \"true\" ]; then pnpm --filter @vm-rotas/api prisma:seed; fi; exec pnpm --filter @vm-rotas/api start:prod"]

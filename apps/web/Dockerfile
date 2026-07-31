FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @vm-rotas/web... --frozen-lockfile=false

COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=/api-proxy
ARG API_PROXY_TARGET=http://localhost:3001/api
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV API_PROXY_TARGET=$API_PROXY_TARGET
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
ENV NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
RUN pnpm --filter @vm-rotas/web build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
EXPOSE 3000
CMD ["pnpm", "--filter", "@vm-rotas/web", "start"]

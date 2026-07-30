# VM Rotas

Base profissional e executável para gestão de entregas, coletas, veículos e otimização de rotas.

## O que já existe nesta primeira versão

- Monorepo TypeScript com frontend e backend separados.
- Autenticação por cookie `HttpOnly` e perfis de usuário preparados no banco.
- Cadastro e listagem de ordens de entrega/coleta.
- Cadastro de veículos.
- Administração de usuários e autorização por função.
- Geração automática de rotas para um ou vários veículos.
- Otimizador local funcional, sem custo e sem credenciais externas.
- Adaptador para Google Route Optimization API em produção.
- Mapa Google no frontend quando uma chave de navegador é configurada.
- Recalculo da parte restante da rota quando uma urgência é adicionada.
- PostgreSQL, Prisma, migração inicial, dados de demonstração, Docker e Swagger.
- Estrutura de deploy no Google Cloud Run + Cloud SQL.

## Stack

- **Frontend:** Next.js 16, React 19 e App Router.
- **Backend:** NestJS 11, REST, Swagger e Passport/JWT.
- **Banco:** PostgreSQL + Prisma ORM 7.
- **Mapas:** Maps JavaScript API, Geocoding API e Route Optimization API.
- **Infraestrutura:** Docker Compose local; Cloud Run, Cloud SQL, Secret Manager e Artifact Registry em produção.

## Início rápido com Docker

1. Copie o arquivo de ambiente:

   ```bash
   cp .env.example .env
   ```

2. Troque `JWT_SECRET` por uma chave longa.

3. Suba o sistema:

   ```bash
   docker compose up --build
   ```

4. Acesse:

   - Sistema: `http://localhost:3000`
   - API: `http://localhost:3001/api`
   - Swagger: `http://localhost:3001/docs`

5. Acesso inicial de desenvolvimento:

   - E-mail: `admin@vmrotas.local`
   - Senha: `Admin@123`

> A senha acima é apenas para o ambiente inicial. Troque-a antes de qualquer uso real.

## Início rápido sem Docker

Requisitos: Node.js 22+, pnpm e PostgreSQL.

```bash
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Google Maps

O projeto funciona em modo local sem Google. Para ativar a integração completa:

- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`: chave restrita por domínio para Maps JavaScript API.
- `GOOGLE_MAPS_SERVER_API_KEY`: chave restrita por IP/serviço para geocodificação no backend.
- `GOOGLE_CLOUD_PROJECT_ID`: projeto do Google Cloud.
- `GOOGLE_ROUTE_OPTIMIZATION_ENABLED=true`.
- Credenciais de serviço via Application Default Credentials no ambiente do backend.
- `ROUTE_OPTIMIZATION_PROVIDER=google`.

Nunca reutilize a chave pública do navegador no backend.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Banco de dados](docs/database.md)
- [Backend](docs/backend.md)
- [Frontend](docs/frontend.md)
- [API](docs/api.md)
- [Segurança](docs/security.md)
- [Deploy](docs/deployment.md)
- [Roadmap](docs/roadmap.md)
- [Validação desta entrega](docs/validation.md)
- [Decisão de stack](docs/adr/0001-stack.md)

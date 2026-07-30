# Arquitetura do VM Rotas

## 1. Visão geral

O VM Rotas começa como um **monólito modular** dividido em dois processos implantáveis:

1. `apps/web`: aplicação Next.js para operadores, gestores e motoristas.
2. `apps/api`: API NestJS com regras de negócio, autenticação, persistência e integrações.

O banco PostgreSQL é a fonte de verdade. O frontend nunca acessa o banco ou as credenciais do Google diretamente.

```text
Navegador PC/celular
        |
        | HTTPS + cookie HttpOnly
        v
Next.js Web  ------------------------+
        |                            |
        | REST/JSON                  | Maps JavaScript API
        v                            v
NestJS API                     Google Maps no navegador
        |
        +---- PostgreSQL / Prisma
        |
        +---- Geocoding API
        |
        +---- Route Optimization API
        |
        +---- Otimizador local (fallback)
```


## Estrutura do repositório

```text
vm-rotas/
├── apps/
│   ├── api/                    # NestJS, Prisma e integrações
│   └── web/                    # Next.js responsivo
├── packages/
│   └── contracts/              # contratos TypeScript compartilháveis
├── docs/                       # arquitetura, banco, API, segurança e deploy
├── infra/
│   └── gcp/                    # Cloud Build e scripts Cloud Run
├── .github/workflows/ci.yml    # validação contínua
├── docker-compose.yml          # execução local completa
├── package.json                # scripts do monorepo
└── pnpm-workspace.yaml
```

## 2. Decisões principais

### Monólito modular antes de microsserviços

O domínio foi separado em módulos (`auth`, `users`, `orders`, `vehicles`, `routes`, `maps`, `dashboard`), mas continua em um único backend. Isso reduz custo operacional e complexidade de deploy sem impedir uma futura extração do motor de otimização ou rastreamento em tempo real.

### Multiempresa preparada desde o banco

As entidades operacionais possuem `organizationId`. A primeira implantação usa uma organização, mas o esquema já evita uma futura migração estrutural para múltiplas empresas ou filiais.

### Motor de otimização intercambiável

A regra de negócio depende de uma interface de otimização, não diretamente do Google. Existem dois provedores:

- `LOCAL`: heurística de prioridade, capacidade e menor distância, útil para desenvolvimento e contingência.
- `GOOGLE`: integração com Route Optimization API, trânsito, janelas de horário e frota.

### Segurança

- Cookie de autenticação `HttpOnly`, `Secure` em produção e `SameSite=Lax`.
- Senhas com hash bcrypt.
- Todas as consultas operacionais filtram `organizationId`.
- Chaves do Google separadas entre navegador e servidor.
- Swagger pode ser desativado ou protegido em produção.
- Logs de auditoria previstos no modelo.

## 3. Módulos do backend

| Módulo | Responsabilidade |
|---|---|
| `auth` | Login, sessão JWT, usuário atual e autorização. |
| `users` | Equipe, funções, ativação e redefinição administrativa de senha. |
| `orders` | Entregas, coletas, urgências, endereço, janela de atendimento e status. |
| `vehicles` | Frota, capacidade e disponibilidade. |
| `routes` | Planejamento, paradas, otimização, reotimização e execução. |
| `maps` | Geocodificação e integrações de mapas. |
| `dashboard` | Indicadores operacionais do dia. |
| `prisma` | Conexão única com PostgreSQL. |
| `health` | Verificação de processo e banco. |

## 4. Fluxo de planejamento

1. O operador cadastra ordens de entrega/coleta.
2. A API geocodifica o endereço quando não há latitude/longitude.
3. O operador escolhe a data e solicita a otimização.
4. A API busca ordens pendentes, veículos ativos e o depósito padrão.
5. O provedor selecionado calcula a distribuição e a sequência.
6. A API persiste `RoutePlan`, `RouteStop` e `OptimizationRun` em transação.
7. O frontend mostra rotas, sequência, métricas e mapa.

## 5. Fluxo de urgência durante o dia

1. A urgência é cadastrada como uma nova ordem com prioridade `URGENT`.
2. O operador informa a rota que deve ser recalculada.
3. Paradas concluídas permanecem congeladas.
4. A posição atual, quando enviada, vira o ponto inicial do trecho restante.
5. O motor reorganiza somente as paradas não concluídas mais a urgência.
6. A revisão da rota é incrementada e o histórico da otimização é mantido.

## 6. Escalabilidade planejada

A primeira versão atende uma operação empresarial com dezenas de usuários e centenas/milhares de ordens diárias, dependendo do plano do banco e da API de otimização. Evoluções previstas:

- Redis para cache, locks e filas.
- Worker assíncrono para otimizações grandes.
- WebSocket/SSE para atualização em tempo real.
- Aplicativo PWA do motorista e rastreamento GPS.
- PostGIS para consultas geográficas avançadas.
- Observabilidade com OpenTelemetry e alertas.

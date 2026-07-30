# Backend

## Organização

O backend está em `apps/api` e usa NestJS como monólito modular. Cada domínio possui controller, service e DTOs próprios. O acesso ao PostgreSQL é centralizado por `PrismaService`.

```text
apps/api/
├── prisma/
│   ├── migrations/             # histórico SQL versionado
│   ├── schema.prisma           # modelo de dados
│   └── seed.ts                 # organização, usuário e dados de demonstração
└── src/
    ├── common/                 # filtros, guards, decorators e utilitários
    ├── config/                 # validação das variáveis de ambiente
    ├── generated/prisma/       # gerado por `prisma generate` (não versionado)
    └── modules/
        ├── auth/
        ├── dashboard/
        ├── health/
        ├── maps/
        ├── orders/
        ├── prisma/
        ├── routes/
        ├── users/
        └── vehicles/
```

## Regras já implementadas

- Login por e-mail e senha, JWT em cookie HttpOnly.
- Isolamento de dados por `organizationId` em todas as consultas operacionais.
- Autorização por função com guards globais.
- Cadastro de usuários, ordens e veículos.
- Geocodificação opcional no cadastro/edição de endereço.
- Otimização local ou Google por uma interface única.
- Persistência transacional das rotas e das paradas.
- Reotimização preservando paradas finalizadas.
- Auditoria de ações importantes.
- Swagger em `/docs` quando `SWAGGER_ENABLED=true` e saúde em `/api/health`.

## Funções

| Função | Leitura | Ordens/frota/planejamento | Execução de parada | Usuários |
|---|---:|---:|---:|---:|
| `OWNER` | Sim | Sim | Sim | Sim, incluindo proprietários |
| `ADMIN` | Sim | Sim | Sim | Sim, exceto proprietários |
| `DISPATCHER` | Sim | Sim | Sim | Não |
| `DRIVER` | Sim | Não | Sim | Não |
| `VIEWER` | Sim | Não | Não | Não |

## Motor local

O provedor `LOCAL` é uma heurística determinística para desenvolvimento e contingência. Ele:

1. ordena ordens por prioridade;
2. distribui carga entre veículos respeitando peso/volume;
3. considera distância até a posição corrente do veículo;
4. aplica vizinho mais próximo ponderado por prioridade;
5. estima duração com velocidade média configurável;
6. gera polilinha compatível com o mapa.

Não usa a malha viária ou o trânsito. Por isso, o resultado local é operacional para testes, mas o provedor `GOOGLE` deve ser usado quando a precisão viária for necessária.

## Transações críticas

A criação de rotas, atualização de ordens, recálculo e mudança de status usam transações Prisma. Isso evita estados intermediários como uma ordem marcada como roteirizada sem sua respectiva parada.

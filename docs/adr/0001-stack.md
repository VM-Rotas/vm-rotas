# ADR 0001 — Stack inicial

**Status:** aceita  
**Data:** 2026-07-30

## Contexto

O VM Rotas precisa funcionar em PC e celular, suportar múltiplos usuários, manter regras complexas de roteamento e integrar-se ao Google Maps.

## Decisão

Usar:

- Next.js 16 no frontend.
- NestJS 11 no backend.
- PostgreSQL + Prisma ORM 7.
- REST/OpenAPI como contrato inicial.
- Docker em todos os ambientes.
- Google Cloud como referência de produção.
- Motor de otimização desacoplado com provedores local e Google.

## Consequências positivas

- TypeScript de ponta a ponta.
- Separação clara de interface e regras de negócio.
- Facilidade de contratação e manutenção.
- Banco relacional adequado a auditoria e estados operacionais.
- Migração futura para serviços separados sem reescrever o domínio.

## Consequências negativas

- Dois processos para implantar.
- Prisma exige geração de cliente e disciplina de migrações.
- A otimização Google tem custo e configuração IAM.
- Rastreamento em tempo real exigirá infraestrutura adicional.

# Validação desta entrega

Data da revisão: **30 de julho de 2026**.

## Verificações concluídas neste ambiente

- Leitura sintática de todos os arquivos TypeScript e TSX: **83 arquivos, sem erros de parsing**.
- Validação dos arquivos JSON: **10 arquivos válidos**.
- Validação dos arquivos YAML: **4 arquivos válidos**.
- Verificação de sintaxe dos scripts Bash de migração e deploy.
- Teste de execução isolado do otimizador local:
  - distribuição de ordens entre veículos;
  - respeito à capacidade de peso;
  - identificação de ordem não alocável;
  - geração de métricas e polilinha.
- Teste do cálculo da data operacional no fuso `America/Sao_Paulo`.
- Teste dos formatadores de distância e duração do frontend.
- Revisão cruzada entre o `schema.prisma` e a migração SQL inicial.

## Verificações que precisam ser executadas em uma máquina com acesso ao registro npm

O ambiente usado para gerar esta base não conseguiu baixar dependências do registro npm e não possui o binário do Docker. Por isso, a instalação completa, a geração real do Prisma Client, o typecheck semântico de dependências, o build do Next/Nest e a subida dos contêineres não foram executados aqui.

Execute na raiz do projeto:

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build
docker compose up --build
```

A primeira instalação criará o `pnpm-lock.yaml`. Depois de validar as versões no seu ambiente, esse arquivo deve ser versionado para tornar os builds reprodutíveis.

## Critérios de aceite da próxima validação

1. `pnpm typecheck`, `pnpm test` e `pnpm build` terminam sem erro.
2. `GET /api/health` retorna banco e processo como `ok`.
3. Login local funciona com o usuário inicial de demonstração.
4. Uma ordem com coordenadas pode ser cadastrada e roteirizada.
5. Uma parada pode avançar até concluída.
6. Uma urgência pode ser inserida e o trecho pendente recalculado.
7. O frontend funciona em larguras de computador e celular.

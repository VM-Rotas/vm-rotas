# Infraestrutura Google Cloud

Este diretório contém uma base reproduzível para construir, migrar e publicar o VM Rotas.

## Ordem recomendada

1. Crie Artifact Registry, Cloud SQL, Secret Manager e a conta de serviço da API.
2. Execute o Cloud Build com `cloudbuild.yaml`.
3. Exporte as variáveis usadas pelos scripts.
4. Execute `./infra/gcp/migrate.sh` uma única vez por versão.
5. Execute `./infra/gcp/deploy.sh`.
6. Associe `web` e `api` a subdomínios do mesmo domínio principal.

## Segredos esperados

- `vm-rotas-database-url`
- `vm-rotas-jwt-secret`
- `vm-rotas-maps-server-key`

O arquivo JSON de uma conta de serviço não deve ser copiado para a imagem. O serviço da API usa a identidade atribuída pelo Cloud Run para chamar o Route Optimization.

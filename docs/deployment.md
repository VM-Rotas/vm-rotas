# Deploy

## Arquitetura recomendada no Google Cloud

- **Cloud Run:** um serviço para `web` e outro para `api`.
- **Cloud SQL for PostgreSQL:** banco gerenciado.
- **Artifact Registry:** imagens Docker.
- **Secret Manager:** `DATABASE_URL`, `JWT_SECRET` e demais segredos.
- **Cloud Logging/Monitoring:** logs, métricas e alertas.
- **Google Maps Platform:** Maps JavaScript, Geocoding e Route Optimization.

## Ambientes

Mantenha pelo menos dois ambientes:

- `staging`: homologação com banco e chaves próprios.
- `production`: operação real, acesso restrito e backups.

## Passos de produção

1. Criar o projeto Google Cloud e ativar APIs necessárias.
2. Criar Artifact Registry.
3. Criar Cloud SQL PostgreSQL com backups e recuperação pontual.
4. Criar conta de serviço da API com apenas as permissões necessárias.
5. Criar segredos no Secret Manager.
6. Construir e publicar as imagens.
7. Executar a migração em um Cloud Run Job.
8. Implantar a API.
9. Implantar o frontend apontando para a URL pública da API.
10. Configurar domínios HTTPS da web e API sob o mesmo domínio principal, CORS e restrições das chaves Google.
11. Usar os exemplos executáveis de `infra/gcp/` para Cloud Build, migração e deploy.

## Migração como job

A migração deve ser um processo único por versão. Não execute migrações concorrentes em todas as instâncias do Cloud Run.

Exemplo conceitual:

```bash
gcloud run jobs execute vm-rotas-migrate --region=southamerica-east1 --wait
```

## Variáveis da API

- `DATABASE_URL`
- `JWT_SECRET`
- `WEB_ORIGIN`
- `COOKIE_SECURE=true`
- `SWAGGER_ENABLED=false`
- `DEFAULT_TIME_ZONE`
- `ROUTE_OPTIMIZATION_PROVIDER`
- `GOOGLE_MAPS_SERVER_API_KEY`
- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_ROUTE_OPTIMIZATION_ENABLED`

## Variáveis do frontend

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_DEMO_MODE=false`
- `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`

Variáveis `NEXT_PUBLIC_*` entram no bundle durante o build; não são segredos.

## Segurança das chaves

- Chave do navegador: restrição por HTTP referrer e somente APIs de frontend.
- Chave do servidor: restrição por serviço/IP quando aplicável.
- Route Optimization: autenticação IAM/OAuth por conta de serviço, sem gravar JSON de credencial na imagem.

## Região

Para uma operação no Brasil, `southamerica-east1` reduz latência. Confirme disponibilidade e preço de cada produto antes da implantação definitiva.


## Arquivos executáveis

- `infra/gcp/cloudbuild.yaml`: constrói e publica as duas imagens.
- `infra/gcp/migrate.sh`: implanta/executa um Cloud Run Job para a migração.
- `infra/gcp/deploy.sh`: publica API e web no Cloud Run.

A imagem da API só executa migração/seed quando `RUN_MIGRATIONS` ou `RUN_SEED` são explicitamente habilitados. No Docker Compose local, ambos estão habilitados; no Cloud Run, devem permanecer desabilitados.

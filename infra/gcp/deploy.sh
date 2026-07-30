#!/usr/bin/env bash
set -Eeuo pipefail

: "${GCP_PROJECT_ID:?Defina GCP_PROJECT_ID}"
: "${IMAGE_TAG:?Defina IMAGE_TAG, normalmente o SHA do commit}"
: "${WEB_ORIGIN:?Defina WEB_ORIGIN, por exemplo https://rotas.seudominio.com.br}"
: "${API_SERVICE_ACCOUNT:?Defina API_SERVICE_ACCOUNT}"
: "${CLOUD_SQL_INSTANCE:?Defina CLOUD_SQL_INSTANCE no formato projeto:regiao:instancia}"

REGION="${REGION:-southamerica-east1}"
REPOSITORY="${REPOSITORY:-vm-rotas}"
API_SERVICE="${API_SERVICE:-vm-rotas-api}"
WEB_SERVICE="${WEB_SERVICE:-vm-rotas-web}"
API_IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/api:${IMAGE_TAG}"
WEB_IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/web:${IMAGE_TAG}"

# A API é pública no nível de rede; autenticação e autorização continuam sendo
# feitas pelo próprio VM Rotas. Use Cloud Armor/IAP caso a política da empresa exija.
gcloud run deploy "${API_SERVICE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --image="${API_IMAGE}" \
  --service-account="${API_SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --add-cloudsql-instances="${CLOUD_SQL_INSTANCE}" \
  --port=3001 \
  --min-instances=0 \
  --max-instances=10 \
  --cpu=1 \
  --memory=1Gi \
  --set-env-vars="NODE_ENV=production,API_PORT=3001,WEB_ORIGIN=${WEB_ORIGIN},COOKIE_SECURE=true,SWAGGER_ENABLED=false,DEFAULT_TIME_ZONE=America/Sao_Paulo,ROUTE_OPTIMIZATION_PROVIDER=${ROUTE_OPTIMIZATION_PROVIDER:-local},GOOGLE_ROUTE_OPTIMIZATION_ENABLED=${GOOGLE_ROUTE_OPTIMIZATION_ENABLED:-false},GOOGLE_CLOUD_PROJECT_ID=${GCP_PROJECT_ID},RUN_MIGRATIONS=false,RUN_SEED=false" \
  --set-secrets="DATABASE_URL=vm-rotas-database-url:latest,JWT_SECRET=vm-rotas-jwt-secret:latest,GOOGLE_MAPS_SERVER_API_KEY=vm-rotas-maps-server-key:latest"

gcloud run deploy "${WEB_SERVICE}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --image="${WEB_IMAGE}" \
  --allow-unauthenticated \
  --port=3000 \
  --min-instances=0 \
  --max-instances=10 \
  --cpu=1 \
  --memory=512Mi

printf '\nDeploy concluído. Vincule os domínios customizados e valide /api/health.\n'

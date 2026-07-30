#!/usr/bin/env bash
set -Eeuo pipefail

: "${GCP_PROJECT_ID:?Defina GCP_PROJECT_ID}"
: "${IMAGE_TAG:?Defina IMAGE_TAG}"
: "${API_SERVICE_ACCOUNT:?Defina API_SERVICE_ACCOUNT}"
: "${CLOUD_SQL_INSTANCE:?Defina CLOUD_SQL_INSTANCE}"

REGION="${REGION:-southamerica-east1}"
REPOSITORY="${REPOSITORY:-vm-rotas}"
JOB_NAME="${JOB_NAME:-vm-rotas-migrate}"
IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/api:${IMAGE_TAG}"

# Implantar/atualizar o job de migração. O comando sobrescreve o CMD da imagem.
gcloud run jobs deploy "${JOB_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --service-account="${API_SERVICE_ACCOUNT}" \
  --set-cloudsql-instances="${CLOUD_SQL_INSTANCE}" \
  --set-secrets="DATABASE_URL=vm-rotas-database-url:latest" \
  --command="pnpm" \
  --args="--filter,@vm-rotas/api,prisma:deploy" \
  --max-retries=1 \
  --task-timeout=10m

gcloud run jobs execute "${JOB_NAME}" \
  --project="${GCP_PROJECT_ID}" \
  --region="${REGION}" \
  --wait

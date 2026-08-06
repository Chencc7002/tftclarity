#!/bin/sh
set -eu

: "${TFT_AGENT_DATABASE_APP_USER:?TFT_AGENT_DATABASE_APP_USER is required}"
: "${TFT_AGENT_DATABASE_APP_PASSWORD:?TFT_AGENT_DATABASE_APP_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_user="$TFT_AGENT_DATABASE_APP_USER" \
  --set=app_password="$TFT_AGENT_DATABASE_APP_PASSWORD" \
  --set=database_name="$POSTGRES_DB" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'app_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'app_user')
\gexec
EOSQL

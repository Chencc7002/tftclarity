#!/usr/bin/env bash
set -euo pipefail

cd /root/tftclarity
docker compose exec -T redis sh -lc '
  printf "dbsize="
  redis-cli --no-auth-warning -a "$REDIS_PASSWORD" DBSIZE
  printf "request_rate_keys="
  redis-cli --no-auth-warning -a "$REDIS_PASSWORD" --scan --pattern "tft:v1:rate:request:*" | wc -l
  printf "session_keys="
  redis-cli --no-auth-warning -a "$REDIS_PASSWORD" --scan --pattern "tft:v1:session:*" | wc -l
  printf "query_keys="
  redis-cli --no-auth-warning -a "$REDIS_PASSWORD" --scan --pattern "tft:v1:query:*" | wc -l
'

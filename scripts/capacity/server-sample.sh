#!/usr/bin/env bash
set -euo pipefail

cd /root/tftclarity

samples="${1:-12}"
interval_seconds="${2:-5}"

printf 'timestamp,mem_available_kb,load_1m,app_cpu,app_mem,caddy_cpu,caddy_mem,postgres_cpu,postgres_mem,redis_cpu,redis_mem\n'
for _ in $(seq 1 "$samples"); do
  timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  mem_available_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  load_1m="$(cut -d ' ' -f 1 /proc/loadavg)"
  stats="$(docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' \
    tftclarity-app-1 \
    tftclarity-caddy-1 \
    tftclarity-postgres-1 \
    tftclarity-redis-1)"
  app="$(printf '%s\n' "$stats" | awk -F, '$1 == "tftclarity-app-1" {print $2 "," $3}')"
  caddy="$(printf '%s\n' "$stats" | awk -F, '$1 == "tftclarity-caddy-1" {print $2 "," $3}')"
  postgres="$(printf '%s\n' "$stats" | awk -F, '$1 == "tftclarity-postgres-1" {print $2 "," $3}')"
  redis="$(printf '%s\n' "$stats" | awk -F, '$1 == "tftclarity-redis-1" {print $2 "," $3}')"
  printf '%s,%s,%s,%s,%s,%s,%s\n' "$timestamp" "$mem_available_kb" "$load_1m" "$app" "$caddy" "$postgres" "$redis"
  sleep "$interval_seconds"
done

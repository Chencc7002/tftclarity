#!/usr/bin/env bash
set -euo pipefail

cd /root/tftclarity

section() {
  printf '\n[%s]\n' "$1"
}

section identity
date -u +'%Y-%m-%dT%H:%M:%SZ'
hostname
printf 'commit='
git rev-parse HEAD
printf 'uptime='
uptime -p
printf 'cpu_count='
nproc

section memory
free -m
printf 'swap_devices='
swapon --show --noheadings || true

section disk
df -h /

section containers
docker compose ps

section container_resources
container_ids="$(docker compose ps -q)"
if [ -n "$container_ids" ]; then
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' $container_ids
fi

section postgres
docker compose exec -T postgres sh -lc \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select current_database(), current_setting('"'"'server_version'"'"'), (select count(*) from pg_stat_activity where datname = current_database());"'

section redis
docker compose exec -T redis sh -lc \
  'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" INFO memory | grep -E "^(used_memory_human|maxmemory_human|maxmemory_policy):"; redis-cli --no-auth-warning -a "$REDIS_PASSWORD" INFO stats | grep -E "^(evicted_keys|rejected_connections|total_error_replies):"; printf "dbsize="; redis-cli --no-auth-warning -a "$REDIS_PASSWORD" DBSIZE'

section runtime_configuration
docker compose exec -T app sh -lc \
  'printf "process_role=%s\nrequest_limit_per_minute=%s\npersistent_store=%s\nephemeral_store=%s\nmemory_fallback=%s\n" "$TFT_AGENT_PROCESS_ROLE" "$TFT_AGENT_REQUESTS_PER_MINUTE" "$TFT_AGENT_PERSISTENT_STORE" "$TFT_AGENT_EPHEMERAL_STORE" "$TFT_AGENT_STORAGE_ALLOW_MEMORY_FALLBACK"'

section local_health
docker compose exec -T app node -e \
  'Promise.all(["health", "ready", "dependencies"].map(async path => { const response = await fetch(`http://127.0.0.1:17317/api/${path}`); console.log(`${path}=${response.status}`); if (!response.ok) process.exitCode = 1; })).catch(error => { console.error(error.message); process.exit(1); })'

section network_counters
awk 'NR > 2 {gsub(":", "", $1); print $1, "rx_bytes=" $2, "tx_bytes=" $10}' /proc/net/dev

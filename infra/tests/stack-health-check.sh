#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/infra/docker-compose.yml"}
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/.env.test"}
SERVICES_STRING=${STACK_HEALTH_SERVICES:-"postgres n8n ai-memory-service"}
STACK_HEALTH_TIMEOUT=${STACK_HEALTH_TIMEOUT:-300}
STACK_HEALTH_INTERVAL=${STACK_HEALTH_INTERVAL:-5}

IFS=' ' read -r -a SERVICES <<< "$SERVICES_STRING"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[stack-health-check] Не найден docker-compose файл: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[stack-health-check] Не найден файл переменных окружения: $ENV_FILE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[stack-health-check] Docker не установлен или недоступен в PATH" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[stack-health-check] Плагин Docker Compose не установлен" >&2
  exit 1
fi

cleanup() {
  echo "[stack-health-check] Останавливаем docker-compose стек"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

start_services() {
  echo "[stack-health-check] Запускаем docker-compose стек"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --quiet-pull --build
}

container_health_status() {
  local container_id="$1"
  docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true
}

wait_for_service_health() {
  local service_name="$1"
  local deadline=$((SECONDS + STACK_HEALTH_TIMEOUT))

  local container_id
  container_id=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q "$service_name")
  if [[ -z "$container_id" ]]; then
    echo "[stack-health-check] Не удалось получить container id для сервиса $service_name" >&2
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    return 1
  fi

  echo "[stack-health-check] Ожидаем health-check для сервиса $service_name (таймаут ${STACK_HEALTH_TIMEOUT}s)"

  while (( SECONDS < deadline )); do
    local status
    status=$(container_health_status "$container_id")

    if [[ "$status" == "healthy" ]]; then
      echo "[stack-health-check] Сервис $service_name перешёл в состояние healthy"
      return 0
    fi

    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      echo "[stack-health-check] Сервис $service_name имеет статус $status" >&2
      docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs "$service_name" >&2 || true
      return 1
    fi

    sleep "$STACK_HEALTH_INTERVAL"
  done

  echo "[stack-health-check] Таймаут ожидания health-check для сервиса $service_name" >&2
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs "$service_name" >&2 || true
  return 1
}

start_services

for service in "${SERVICES[@]}"; do
  wait_for_service_health "$service"
done

echo "[stack-health-check] Все указанные сервисы в состоянии healthy"

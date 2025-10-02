# AI Radar

[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-blue.svg)](#настройка-ci)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![npm version](https://img.shields.io/badge/npm-1.0.0-orange.svg)
![Docker image](https://img.shields.io/badge/docker-n8n--latest-0db7ed.svg)

## Назначение проекта
AI Radar объединяет n8n, PostgreSQL и внутренний Memory Service для построения цепочек обработки запросов и хранения истории взаимодействий. Инфраструктура в `infra/` и конфигурация в `config/` позволяют быстро развернуть стек сервиса, а Node.js-приложение в `scripts/` отвечает за API для работы с памятью и интеграцию с LLM.

## Минимальные требования
- **Операционная система:** Linux, macOS или Windows с поддержкой Docker Desktop.
- **Docker:** версия 24.0+ и плагин Docker Compose 2.20+.
- **Node.js:** 18 LTS или новее для локального запуска памяти.
- **npm:** 9.0+ (соответствует Node.js 18) для управления зависимостями `scripts/`.
- **Дополнительно:** доступ к сети для загрузки образов Docker Hub и npm-пакетов.

## Структура каталогов
```text
.
├── .env.example
├── .env.test
├── .github/
│   └── workflows/
│       └── ci.yml
├── LICENSE
├── README.md
├── config/
│   └── postgres/
│       └── init.sql
├── docker-compose.test.yml
├── infra/
│   ├── Caddyfile
│   └── docker-compose.yml
└── scripts/
    ├── Dockerfile
    ├── __tests__/
    │   └── chat-with-memory.test.js
    ├── eslint.config.cjs
    ├── jest.config.base.cjs
    ├── jest.config.e2e.cjs
    ├── jest.config.smoke.cjs
    ├── jest.config.unit.cjs
    ├── llm-client.js
    ├── llm-client.test.js
    ├── memory-service.js
    ├── memory-service.test.js
    ├── package-lock.json
    ├── package.json
    ├── test-connection.js
    └── tests/
        └── ...
```

## Локальный запуск
### Вариант 1. Docker Compose
1. Скопируйте переменные окружения и при необходимости скорректируйте их:
   ```bash
   cp .env.example .env
   ```
2. Перейдите в каталог инфраструктуры и запустите стек:
   ```bash
   cd infra
   docker compose --env-file ../.env up -d --build
   ```
3. Дождитесь, пока сервисы пройдут health-check (`ai-radar-postgres`, `ai-radar-n8n`, `ai-radar-memory`). Проверить состояние можно командой `docker compose ps`.
4. N8N будет доступен по адресу `http://<N8N_HOST>:<N8N_PORT>`, API памяти — на `http://localhost:3000` (переопределяется переменными окружения).
5. Остановите и очистите ресурсы по завершении работы:
   ```bash
   docker compose down --volumes
   ```

### Вариант 2. NPM для Memory Service
1. Убедитесь, что PostgreSQL запущен и доступен согласно переменным окружения (`.env.example`). Удобнее всего использовать Docker Compose из предыдущего пункта.
2. Установите зависимости:
   ```bash
   cd scripts
   npm ci
   ```
3. Проверьте соединение с базой данных:
   ```bash
   npm run test:connection
   ```
4. Запустите сервис локально:
   ```bash
   npm run start
   ```
5. Дополнительно можно выполнить тесты (`npm test`) перед коммитом.

## Сервисы и ссылки
### Docker Hub
- [postgres:15-alpine](https://hub.docker.com/_/postgres)
- [n8nio/n8n:latest](https://hub.docker.com/r/n8nio/n8n)

### npm
- [express](https://www.npmjs.com/package/express)
- [pg](https://www.npmjs.com/package/pg)
- [axios](https://www.npmjs.com/package/axios)

### Telegram-демо
- [AI Radar Demo Bot](https://t.me/ai_radar_demo_bot)

### Веб-сайт
- [AI Radar](https://ai-radar.example.com)

## Лицензия
Проект распространяется по лицензии [MIT](LICENSE). Ознакомьтесь с условиями перед использованием.

## Настройка CI
В репозитории настроен workflow GitHub Actions (`.github/workflows/ci.yml`), который прогоняет тесты на pull request и при push в `main`/`master`.

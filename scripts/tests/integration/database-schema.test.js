const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { Client } = require('pg');

const TABLES = [
  'users',
  'products',
  'product_metrics',
  'user_alerts',
  'ai_sessions',
  'digest_history',
];

const INDEXES = [
  'idx_products_category',
  'idx_products_source',
  'idx_products_parsed_at',
  'idx_metrics_product_id',
  'idx_metrics_recorded_at',
  'idx_users_telegram_id',
  'idx_sessions_session_id',
  'idx_sessions_created_at',
];

function run(command) {
  return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
}

describe('PostgreSQL schema initialization', () => {
  let containerName;
  let client;
  let connectionConfig;

  beforeAll(async () => {
    containerName = `ai-radar-integration-${Date.now()}`;

    const user = 'postgres';
    const password = 'postgres';
    const database = 'postgres';

    run(
      [
        'docker run -d --rm',
        `--name ${containerName}`,
        '-e POSTGRES_USER=postgres',
        '-e POSTGRES_PASSWORD=postgres',
        '-e POSTGRES_DB=postgres',
        '-p 0:5432',
        'postgres:16-alpine',
      ].join(' '),
    );

    const portOutput = run(`docker port ${containerName} 5432/tcp`);
    const hostPort = parseInt(portOutput.split(':').pop(), 10);

    connectionConfig = {
      host: '127.0.0.1',
      port: hostPort,
      user,
      password,
      database,
    };

    await waitForDatabase(connectionConfig);

    client = new Client(connectionConfig);
    await client.connect();

    const initSqlPath = path.resolve(__dirname, '../../../config/postgres/init.sql');
    const initSql = fs.readFileSync(initSqlPath, 'utf-8');

    await client.query(initSql);
  }, 180000);

  afterAll(async () => {
    if (client) {
      await client.end();
    }

    if (containerName) {
      try {
        run(`docker stop ${containerName}`);
      } catch (error) {
        // контейнер может быть уже остановлен
      }
    }
  });

  test('создает все ожидаемые таблицы', async () => {
    const results = await Promise.all(
      TABLES.map(async (table) => {
        const { rows } = await client.query('SELECT to_regclass($1) AS exists', [`public.${table}`]);
        return { table, exists: rows[0].exists !== null };
      }),
    );

    results.forEach(({ table, exists }) => {
      expect(exists).toBe(true);
    });
  });

  test('создает все ожидаемые индексы', async () => {
    const results = await Promise.all(
      INDEXES.map(async (index) => {
        const { rows } = await client.query('SELECT to_regclass($1) AS exists', [`public.${index}`]);
        return { index, exists: rows[0].exists !== null };
      }),
    );

    results.forEach(({ index, exists }) => {
      expect(exists).toBe(true);
    });
  });
});

async function waitForDatabase(config) {
  const start = Date.now();
  const timeout = 60000;
  let lastError;

  while (Date.now() - start < timeout) {
    const attempt = new Client(config);
    try {
      await attempt.connect();
      await attempt.end();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw lastError || new Error('PostgreSQL не запустился вовремя');
}

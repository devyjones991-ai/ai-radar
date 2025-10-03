const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envFileName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  const envPath = path.resolve(__dirname, '..', envFileName);
  if (!fs.existsSync(envPath)) {
    return;
  }
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== undefined) {
      continue;
    }
    const value = rest.join('=');
    process.env[key] = value;
  }
}

// Try dotenv first; if unavailable, fallback to manual loader
try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  loadEnvFile();
}

const express = require('express');
const { Pool } = require('pg');
const llmClient = require('./llm-client');

const CONNECTION_KEYS = ['host', 'port', 'database', 'user', 'password'];

function pickAdditionalOptions(options) {
  const result = {};
  for (const [key, value] of Object.entries(options)) {
    if (!CONNECTION_KEYS.includes(key) && key !== 'connectionString' && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeConfig(config) {
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

function hasConnectionConfig(config) {
  return CONNECTION_KEYS.some(key => config[key] !== undefined);
}

function createPool(options = {}) {
  const { connectionString: optionConnectionString, ...restOptions } = options;

  if (optionConnectionString) {
    const additionalOptions = pickAdditionalOptions(restOptions);
    return new Pool({ connectionString: optionConnectionString, ...additionalOptions });
  }

  const envConfig = {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  };

  const mergedConfig = sanitizeConfig({ ...envConfig, ...restOptions });

  if (hasConnectionConfig(mergedConfig)) {
    return new Pool(mergedConfig);
  }

  const envConnectionString = process.env.DATABASE_URL;
  if (envConnectionString) {
    const additionalOptions = pickAdditionalOptions(restOptions);
    return new Pool({ connectionString: envConnectionString, ...additionalOptions });
  }

  const additionalOptions = sanitizeConfig(restOptions);
  return new Pool(additionalOptions);
}

const pool = createPool();

async function chatWithMemoryHandler(sessionId, userMessage, activePool, activeLlmClient, model = 'grok-beta') {
  const sessionContext = await getSessionContext(sessionId, activePool);
  const response = await activeLlmClient.chatWithContext(sessionContext, userMessage, { model });
  await saveMessage(sessionId, 'user', userMessage, activePool);
  await saveMessage(sessionId, 'assistant', response, activePool);
  return response;
}

async function getSessionContext(sessionId, activePool) {
  const res = await activePool.query(
    'SELECT role, content FROM memory_service WHERE session_id = $1 ORDER BY timestamp ASC',
    [sessionId]
  );
  return res.rows.map(r => ({ role: r.role, content: r.content }));
}

async function saveMessage(sessionId, role, content, activePool) {
  await activePool.query(
    'INSERT INTO memory_service (session_id, role, content) VALUES ($1, $2, $3)',
    [sessionId, role, content]
  );
}

function createApp({ pool: providedPool, llmClient: providedLlmClient, defaultModel } = {}) {
  const app = express();

  app.use(express.json());

  const activePool = providedPool ?? pool;
  const activeLlmClient = providedLlmClient ?? llmClient;

  app.post('/chat', async (req, res) => {
    try {
      const { session_id: sessionId, message, model } = req.body;
      if (!sessionId || !message) {
        return res.status(400).json({ error: 'session_id and message are required' });
      }
      const effectiveModel = model || defaultModel || 'grok-beta';
      const response = await chatWithMemoryHandler(sessionId, message, activePool, activeLlmClient, effectiveModel);
      res.json({ response });
    } catch (err) {
      console.error('Error in /chat:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = {
  createApp,
  chatWithMemoryHandler,
  getSessionContext,
  saveMessage,
  createPool,
  pool,
};

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Memory service listening on port ${port}`);
  });
}
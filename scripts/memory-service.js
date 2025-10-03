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

function sanitizeConfig(config) {
  const sanitized = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'port') {
      const parsedPort = Number(value);
      sanitized[key] = Number.isNaN(parsedPort) ? value : parsedPort;
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function pickAdditionalOptions(options) {
  const result = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) {
      continue;
    }
    if (CONNECTION_KEYS.includes(key)) {
      continue;
    }
    result[key] = value;
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

function createService({ pool: providedPool, llmClient: providedLlmClient } = {}) {
  const app = express();
  app.use(express.json());

  const pool = providedPool ?? createPool();
  const activeLlmClient = providedLlmClient ?? llmClient;

  async function getSessionContext(sessionId, limit = 10) {
    const result = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [sessionId, limit]
    );
    return result.rows.reverse();
  }

  async function saveMessage(sessionId, role, content) {
    await pool.query(
      'INSERT INTO messages (session_id, role, content, timestamp) VALUES ($1, $2, $3, NOW())',
      [sessionId, role, content]
    );
  }

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/chat', async (req, res) => {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }
    try {
      await saveMessage(sessionId, 'user', message);
      const context = await getSessionContext(sessionId);
      const { content } = await activeLlmClient.generate({ prompt: message, context });
      await saveMessage(sessionId, 'assistant', content);
      res.status(200).json({ response: content });
    } catch (error) {
      console.error('Error in /chat:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return { app, pool };
}

module.exports = { createService, createPool };
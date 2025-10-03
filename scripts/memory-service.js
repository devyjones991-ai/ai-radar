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
  for (const key in options) {
    if (Object.prototype.hasOwnProperty.call(options, key) && !CONNECTION_KEYS.includes(key)) {
      result[key] = options[key];
    }
  }
  return result;
}

const DB_CONFIG_FROM_ENV = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};
const additionalOptions = pickAdditionalOptions({
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT ? parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) : undefined,
  idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT ? parseInt(process.env.DB_IDLE_TIMEOUT, 10) : undefined,
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : undefined,
});

function createPool(config = {}) {
  const finalConfig = { ...DB_CONFIG_FROM_ENV, ...additionalOptions, ...config };
  return new Pool(finalConfig);
}

const pool = createPool();

async function getSessionContext(sessionId, limit = 10) {
  const query = `
    SELECT role, message_text, created_at
    FROM chat_messages
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  const result = await pool.query(query, [sessionId, limit]);
  return result.rows.reverse();
}

function formatMessagesForPrompt(context, newUserMessage = null) {
  let messages = context.map(msg => `${msg.role}: ${msg.message_text}`).join('\n');
  if (newUserMessage) {
    messages += `\n${newUserMessage.role}: ${newUserMessage.message_text}`;
  }
  return messages;
}

async function saveMessage(sessionId, role, messageText, model = null, metadata = null) {
  const query = `
    INSERT INTO chat_messages (session_id, role, message_text, model, metadata)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, created_at
  `;
  const result = await pool.query(query, [
    sessionId,
    role,
    messageText,
    model,
    metadata ? JSON.stringify(metadata) : null,
  ]);
  return result.rows[0];
}

function createService({ pool: servicePool = pool, llmClient: serviceLlmClient = llmClient, defaultModel: fallbackModel = 'grok-beta' } = {}) {
  async function getSessionContext(sessionId, limit = 10) {
    const query = `
      SELECT role, message_text, created_at
      FROM chat_messages
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await servicePool.query(query, [sessionId, limit]);
    return result.rows.reverse();
  }

  async function saveMessage(sessionId, role, messageText, model = null, metadata = null) {
    const query = `
      INSERT INTO chat_messages (session_id, role, message_text, model, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `;
    const result = await servicePool.query(query, [
      sessionId,
      role,
      messageText,
      model,
      metadata ? JSON.stringify(metadata) : null,
    ]);
    return result.rows[0];
  }

  async function chatWithMemoryHandler(sessionId, message) {
    const context = await getSessionContext(sessionId, 10);
    const prompt = formatMessagesForPrompt(context, { role: 'user', message_text: message });

    const llmResponse = await serviceLlmClient.generate({
      model: fallbackModel,
      prompt: prompt,
      stream: false,
    });

    const assistantMessage = llmResponse.response;

    await saveMessage(sessionId, 'user', message, fallbackModel, null);
    await saveMessage(sessionId, 'assistant', assistantMessage, fallbackModel, null);

    return assistantMessage;
  }

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/chat', async (req, res) => {
    try {
      const { session_id: sessionId, message, model } = req.body;
      if (!sessionId || !message) {
        return res.status(400).json({ error: 'session_id and message are required' });
      }
      const effectiveModel = model || fallbackModel;
      const response = await chatWithMemoryHandler(sessionId, message);
      res.json({ response });
    } catch (err) {
      console.error('Error in /chat:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return { app, pool: servicePool, getSessionContext, saveMessage };
}

async function chatWithMemoryHandler(sessionId, userMessage, activePool, activeLlmClient, effectiveModel) {
  const context = await getSessionContext(sessionId, 10);
  const prompt = formatMessagesForPrompt(context, { role: 'user', message_text: userMessage });

  const llmResponse = await activeLlmClient.generate({
    model: effectiveModel,
    prompt: prompt,
    stream: false,
  });

  const assistantMessage = llmResponse.response;

  await saveMessage(sessionId, 'user', userMessage, effectiveModel, null);
  await saveMessage(sessionId, 'assistant', assistantMessage, effectiveModel, null);

  return assistantMessage;
}

function createApp({ pool: activePool = pool, llmClient: activeLlmClient = llmClient, defaultModel = null } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/chat', async (req, res) => {
    try {
      const { sessionId, session_id, message, model, options } = req.body;
      const effectiveSessionId = sessionId || session_id;
      if (!effectiveSessionId || !message) {
        return res.status(400).json({ error: 'sessionId (or session_id) and message are required' });
      }
      const effectiveModel = model || defaultModel || 'grok-beta';
      const response = await chatWithMemoryHandler(effectiveSessionId, message, activePool, activeLlmClient, effectiveModel);
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
  createService,
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
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

  const sanitized = sanitizeConfig(envConfig);
  const hasConnection = hasConnectionConfig(sanitized);

  if (hasConnection) {
    const additionalOptions = pickAdditionalOptions(restOptions);
    return new Pool({ ...sanitized, ...additionalOptions });
  }

  const fallbackConnectionString = process.env.DATABASE_URL;
  if (fallbackConnectionString) {
    const additionalOptions = pickAdditionalOptions(restOptions);
    return new Pool({ connectionString: fallbackConnectionString, ...additionalOptions });
  }

  throw new Error('No database configuration found');
}

const pool = createPool();

function formatMessagesForPrompt(messages, latestUserMessage) {
  const fullContext = latestUserMessage ? [...messages, latestUserMessage] : messages;
  return fullContext.map(({ role, message_text: text }) => `${role}: ${text}`).join('\n');
}

async function getSessionContext(sessionId, limit = 10) {
  try {
    const result = await pool.query(
      `SELECT role, message_text, model_used, tokens_used, created_at
       FROM ai_sessions
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows.reverse();
  } catch (error) {
    console.error('Error getting session context:', error);
    return [];
  }
}

async function saveMessage(sessionId, role, messageText, modelUsed = null, tokensUsed = null) {
  try {
    await pool.query(
      `INSERT INTO ai_sessions (session_id, role, message_text, model_used, tokens_used)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, role, messageText, modelUsed, tokensUsed]
    );
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
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

function createService({ pool: providedPool, llmClient: providedLlmClient, defaultModel } = {}) {
  const app = express();
  app.use(express.json());

  const servicePool = providedPool ?? createPool();
  const activeLlmClient = providedLlmClient ?? llmClient;
  const fallbackModel = defaultModel || process.env.LLM_DEFAULT_MODEL || 'deepseek-r1:70b';

  async function getSessionContext(sessionId, limit = 10) {
    try {
      const result = await servicePool.query(
        `SELECT role, message_text, model_used, tokens_used, created_at
         FROM ai_sessions
         WHERE session_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [sessionId, limit]
      );
      return result.rows.reverse();
    } catch (error) {
      console.error('Error getting session context:', error);
      return [];
    }
  }

  async function saveMessage(sessionId, role, messageText, modelUsed = null, tokensUsed = null) {
    try {
      await servicePool.query(
        `INSERT INTO ai_sessions (session_id, role, message_text, model_used, tokens_used)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, role, messageText, modelUsed, tokensUsed]
      );
    } catch (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  }

  async function chatWithMemoryHandler(sessionId, userMessage) {
    const context = await getSessionContext(sessionId, 10);
    const prompt = formatMessagesForPrompt(context, { role: 'user', message_text: userMessage });

    const llmResponse = await activeLlmClient.generate({
      model: fallbackModel,
      prompt: prompt,
      stream: false,
    });

    const assistantMessage = llmResponse.response;

    await saveMessage(sessionId, 'user', userMessage, fallbackModel, null);
    await saveMessage(sessionId, 'assistant', assistantMessage, fallbackModel, null);

    return assistantMessage;
  }

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
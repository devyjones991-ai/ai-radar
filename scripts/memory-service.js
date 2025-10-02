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
    if (!key) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== undefined) {
      continue;
    }

    const value = rest.join('=');
    process.env[key] = value;
  }
}

loadEnvFile();

const express = require('express');
const { Pool } = require('pg');
const llmClient = require('./llm-client');

try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const DEFAULT_POOL_CONFIG = {
  host: process.env.POSTGRES_HOST ?? 'postgres',
  port: process.env.POSTGRES_PORT ?? 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};

function createPool(overrides = {}) {
  return new Pool({
    ...DEFAULT_POOL_CONFIG,
    ...overrides,
  });
}

const DEFAULT_MODEL = 'deepseek-r1:70b';
const DEFAULT_CONTEXT_LIMIT = 10;

function createSessionStore(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('A valid PostgreSQL pool instance is required');
  }

  async function getSessionContext(sessionId, limit = DEFAULT_CONTEXT_LIMIT) {
    try {
      const result = await pool.query(
        'SELECT role, message_text, model_used, created_at FROM ai_sessions WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
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
        'INSERT INTO ai_sessions (session_id, role, message_text, model_used, tokens_used) VALUES ($1, $2, $3, $4, $5)',
        [sessionId, role, messageText, modelUsed, tokensUsed]
      );
    } catch (error) {
      console.error('Error saving message:', error);
    }
  }

  return { getSessionContext, saveMessage };
}

function chatWithMemoryHandler({
  pool,
  llmClient: llm,
  defaultModel = DEFAULT_MODEL,
  contextLimit = DEFAULT_CONTEXT_LIMIT,
  getSessionContext,
  saveMessage,
} = {}) {
  if (!pool) {
    throw new Error('pool is required for chatWithMemoryHandler');
  }
  if (!llm || typeof llm.generate !== 'function') {
    throw new Error('llmClient with a generate method is required');
  }

  const sessionStore =
    getSessionContext && saveMessage
      ? { getSessionContext, saveMessage }
      : createSessionStore(pool);

  const resolveContext = sessionStore.getSessionContext;
  const persistMessage = sessionStore.saveMessage;

  return async function chatWithMemory(req, res) {
    try {
      const {
        message,
        sessionId = 'default',
        model = defaultModel,
        options = {},
      } = req.body || {};

      const context = await resolveContext(sessionId, contextLimit);

      let fullPrompt = '';
      if (context.length > 0) {
        fullPrompt = context.map(c => `${c.role}: ${c.message_text}`).join('\n') + '\n';
      }
      fullPrompt += `user: ${message}`;

      const llmResult = await llm.generate(fullPrompt, { model, options });

      await persistMessage(sessionId, 'user', message, model);
      await persistMessage(sessionId, 'assistant', llmResult.response, model, llmResult.evalCount);

      res.json({
        response: llmResult.response,
        sessionId,
        model,
        contextUsed: context.length > 0,
        llmDisabled: !!llmResult.disabled,
        evalCount: llmResult.evalCount,
      });
    } catch (error) {
      console.error('Error in chat-with-memory:', error);
      res.status(500).json({ error: 'Failed to generate response' });
    }
  };
}

function createApp({
  pool = createPool(),
  llm = llmClient,
  defaultModel = DEFAULT_MODEL,
  contextLimit = DEFAULT_CONTEXT_LIMIT,
} = {}) {
  const app = express();
  app.use(express.json());

  const sessionStore = createSessionStore(pool);

  app.post(
    '/chat-with-memory',
    chatWithMemoryHandler({
      pool,
      llmClient: llm,
      defaultModel,
      contextLimit,
      getSessionContext: sessionStore.getSessionContext,
      saveMessage: sessionStore.saveMessage,
    })
  );

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.pool = pool;
  app.getSessionContext = sessionStore.getSessionContext;
  app.saveMessage = sessionStore.saveMessage;

  return app;
}

const app = createApp();

const { pool } = app;
const getSessionContext = app.getSessionContext;
const saveMessage = app.saveMessage;

const PORT = process.env.PORT || 3003;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Memory service listening on port ${PORT}`);
  });
}

module.exports = {
  createPool,
  createApp,
  chatWithMemoryHandler,
  app,
  getSessionContext,
  saveMessage,
  pool,
};
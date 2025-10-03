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

try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }

  loadEnvFile();
}

const express = require('express');
const { Pool } = require('pg');
const llmClient = require('./llm-client');

function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

const pool = createPool();

async function getSessionContext(sessionId, limit = 10, poolInstance = pool) {
  try {
    const result = await poolInstance.query(
      'SELECT role, message_text, model_used, tokens_used, created_at FROM ai_sessions WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
      [sessionId, limit]
    );

    return result.rows.slice().reverse();
  } catch (error) {
    console.error('Error getting session context:', error);
    return [];
  }
}

async function saveMessage(sessionId, role, message, modelUsed, tokensUsed, poolInstance = pool) {
  try {
    await poolInstance.query(
      'INSERT INTO ai_sessions (session_id, role, message_text, model_used, tokens_used) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, role, message, modelUsed ?? null, tokensUsed ?? null]
    );
  } catch (error) {
    console.error('Error saving message:', error);
  }
}

function buildPrompt(contextRows, message) {
  const lines = [];

  for (const row of contextRows) {
    if (row?.role && row?.message_text) {
      lines.push(`${row.role}: ${row.message_text}`);
    }
  }

  lines.push(`user: ${message}`);

  return lines.join('\n');
}

function mapContextForResponse(rows) {
  return rows.map(row => ({
    role: row.role,
    content: row.message_text,
    modelUsed: row.model_used ?? null,
    tokensUsed: row.tokens_used ?? null,
    createdAt: row.created_at ?? null,
  }));
}

function chatWithMemoryHandler({ pool: providedPool, llmClient: providedLlmClient, defaultModel } = {}) {
  const activePool = providedPool ?? pool;
  const activeLlmClient = providedLlmClient ?? llmClient;
  const resolvedDefaultModel = defaultModel ?? process.env.LLM_DEFAULT_MODEL;

  return async (req, res) => {
    const { message, sessionId, model, options } = req.body || {};

    if (!message || !sessionId) {
      return res.status(400).json({ error: 'message and sessionId are required' });
    }

    try {
      const contextRows = await getSessionContext(sessionId, 10, activePool);
      const prompt = buildPrompt(contextRows, message);
      const selectedModel = model || resolvedDefaultModel;
      const contextUsed = contextRows.length > 0;

      await saveMessage(sessionId, 'user', message, selectedModel, null, activePool);

      const generation = await activeLlmClient.generate(prompt, {
        model: selectedModel,
        options,
      });

      const responseText = generation?.response ?? '';
      const responseModel = generation?.model || selectedModel;
      const tokensUsed = generation?.evalCount ?? null;
      const llmDisabled = Boolean(generation?.disabled);

      await saveMessage(sessionId, 'assistant', responseText, responseModel, tokensUsed, activePool);

      res.status(200).json({
        response: responseText,
        sessionId,
        model: responseModel,
        evalCount: generation?.evalCount ?? null,
        tokensUsed,
        llmDisabled,
        contextUsed,
        context: mapContextForResponse(contextRows),
      });
    } catch (error) {
      console.error('Error in chatWithMemoryHandler:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

function createApp({ pool: providedPool, llmClient: providedLlmClient, defaultModel } = {}) {
  const app = express();
  app.use(express.json());

  const activePool = providedPool ?? pool;
  const activeLlmClient = providedLlmClient ?? llmClient;

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const handler = chatWithMemoryHandler({ pool: activePool, llmClient: activeLlmClient, defaultModel });

  app.post('/chat-with-memory', handler);

  app.pool = activePool;
  app.getSessionContext = (sessionId, limit) => getSessionContext(sessionId, limit, activePool);
  app.saveMessage = (sessionId, role, message, modelUsed, tokensUsed) =>
    saveMessage(sessionId, role, message, modelUsed, tokensUsed, activePool);

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

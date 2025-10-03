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

function createPool(options = {}) {
  const { connectionString = process.env.DATABASE_URL, ...rest } = options;
  const poolConfig = { ...rest };
  if (connectionString) {
    poolConfig.connectionString = connectionString;
  }
  return new Pool(poolConfig);
}

function formatMessagesForPrompt(messages, latestUserMessage) {
  const fullContext = latestUserMessage ? [...messages, latestUserMessage] : messages;
  return fullContext.map(({ role, message_text: text }) => `${role}: ${text}`).join('\n');
}

function createService({ pool: providedPool, llmClient: providedLlmClient, defaultModel } = {}) {
  const app = express();
  app.use(express.json());

  const pool = providedPool ?? createPool();
  const activeLlmClient = providedLlmClient ?? llmClient;
  const fallbackModel = defaultModel || process.env.LLM_DEFAULT_MODEL || 'deepseek-r1:70b';

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

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/chat', async (req, res) => {
    const { sessionId, message, model = fallbackModel, options = {} } = req.body || {};
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }
    try {
      const previousContext = await getSessionContext(sessionId);
      const userMessage = { role: 'user', message_text: message };
      await saveMessage(sessionId, 'user', message, model, null);

      const prompt = formatMessagesForPrompt(previousContext, userMessage);
      const llmResult = await activeLlmClient.generate(prompt, { model, options });
      const assistantResponse = llmResult?.response;
      if (!assistantResponse) {
        throw new Error('LLM returned empty response');
      }

      const resolvedModel = llmResult?.model ?? model ?? fallbackModel;
      const tokensUsed = llmResult?.evalCount ?? null;

      await saveMessage(sessionId, 'assistant', assistantResponse, resolvedModel, tokensUsed);

      res.status(200).json({
        response: assistantResponse,
        sessionId,
        model: resolvedModel,
        contextUsed: previousContext.length > 0,
        evalCount: llmResult?.evalCount ?? null,
        llmDisabled: Boolean(llmResult?.disabled ?? false),
      });
    } catch (error) {
      console.error('Error in /chat:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.getSessionContext = getSessionContext;
  app.saveMessage = saveMessage;

  return { app, pool, getSessionContext, saveMessage };
}

module.exports = { createService, createPool };

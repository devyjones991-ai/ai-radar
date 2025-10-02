const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

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

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'postgres',
  port: process.env.POSTGRES_PORT ?? 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';

async function getSessionContext(sessionId, limit = 10) {
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

app.post('/chat-with-memory', async (req, res) => {
  try {
    const { message, sessionId = 'default', model = 'deepseek-r1:70b', options = {} } = req.body;

    const context = await getSessionContext(sessionId);
    
    let fullPrompt = '';
    if (context.length > 0) {
      fullPrompt = context.map(c => `${c.role}: ${c.message_text}`).join('\n') + '\n';
    }
    fullPrompt += `user: ${message}`;

    const ollamaResponse = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: model,
      prompt: fullPrompt,
      stream: false,
      options: {
        ...options,
        temperature: options.temperature ?? 0.3,
        top_p: options.top_p ?? 0.9,
      },
    });

    const response = ollamaResponse.data.response;

    await saveMessage(sessionId, 'user', message, model);
    await saveMessage(sessionId, 'assistant', response, model, ollamaResponse.data.eval_count);

    res.json({
      response: response,
      sessionId: sessionId,
      model: model,
      contextUsed: context.length > 0
    });

  } catch (error) {
    console.error('Error in chat-with-memory:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

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

const PORT = process.env.PORT || 3003;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Memory service listening on port ${PORT}`);
  });
}

module.exports = { createPool, app };
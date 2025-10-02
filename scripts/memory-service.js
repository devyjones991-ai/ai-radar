const fs = require('fs');
const path = require('path');

loadEnvFile();

const express = require('express');
const { Pool } = require('pg');
const llmClient = require('./llm-client');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

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

app.post('/chat-with-memory', async (req, res) => {
  try {
    const { message, sessionId = 'default', model = 'deepseek-r1:70b', options = {} } = req.body;

    const context = await getSessionContext(sessionId);

    let fullPrompt = '';
    if (context.length > 0) {
      fullPrompt = context.map(c => `${c.role}: ${c.message_text}`).join('\n') + '\n';
    }
    fullPrompt += `user: ${message}`;

    const llmResult = await llmClient.generate(fullPrompt, { model, options });

    await saveMessage(sessionId, 'user', message, model);
    await saveMessage(sessionId, 'assistant', llmResult.response, model, llmResult.evalCount);

    res.json({
      response: llmResult.response,
      sessionId: sessionId,
      model: model,
      contextUsed: context.length > 0,
      llmDisabled: !!llmResult.disabled,
      evalCount: llmResult.evalCount,
    });
  } catch (error) {
    console.error('Error in chat-with-memory:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Memory Service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  getSessionContext,
  saveMessage,
  pool,
};

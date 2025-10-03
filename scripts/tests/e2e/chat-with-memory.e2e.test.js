const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { createService, createPool } = require('../../memory-service');

jest.setTimeout(30000);

describe('E2E: /chat', () => {
  let pool;
  let app;
  let llmClient;
  let skipSuite = false;
  const createdSessions = new Set();

  beforeAll(async () => {
    try {
      pool = createPool({
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT || 5432),
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'postgres',
      });

      await pool.query('SELECT 1');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_sessions (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL,
          message_text TEXT NOT NULL,
          model_used VARCHAR(100),
          tokens_used INTEGER,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      llmClient = {
        generate: jest.fn().mockResolvedValue({
          response: 'E2E response',
          evalCount: 256,
          disabled: false,
          model: 'e2e-model',
        }),
      };

      ({ app } = createService({ pool, llmClient, defaultModel: 'e2e-model' }));
    } catch (e) {
      console.warn('E2E: PostgreSQL unavailable, skipping suite');
      skipSuite = true;
    }
  });

  afterAll(async () => {
    if (skipSuite || !pool) return;
    if (createdSessions.size > 0) {
      await pool.query('DELETE FROM ai_sessions WHERE session_id = ANY($1)', [
        Array.from(createdSessions),
      ]);
    }
    await pool.end();
  });

  it('сохраняет сообщения пользователя и ассистента в PostgreSQL', async () => {
    if (skipSuite) {
      console.warn('E2E тест пропущен: отсутствует соединение с PostgreSQL.');
      return;
    }

    const sessionId = uuidv4();
    createdSessions.add(sessionId);

    const response = await request(app)
      .post('/chat')
      .send({
        message: 'Привет из e2e',
        sessionId,
      });

    expect(response.status).toBe(200);
    expect(response.body.response).toBe('E2E response');
    expect(response.body).toEqual(
      expect.objectContaining({
        sessionId,
        model: 'e2e-model',
        contextUsed: false,
        evalCount: 256,
        llmDisabled: false,
      })
    );
    expect(llmClient.generate).toHaveBeenCalledTimes(1);

    const { rows } = await pool.query(
      `SELECT role, message_text, model_used, tokens_used
         FROM ai_sessions WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        message_text: 'Привет из e2e',
        model_used: 'e2e-model',
      })
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        message_text: 'E2E response',
        model_used: 'e2e-model',
        tokens_used: 256,
      })
    );
  });
});

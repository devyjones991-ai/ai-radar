const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { createApp, createPool } = require('../../memory-service');

jest.setTimeout(30000);

describe('E2E: /chat-with-memory', () => {
  let pool;
  let app;
  let llmClient;
  let skipSuite = false;

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
        }),
      };

      app = createApp({ pool, llmClient, defaultModel: 'e2e-model' });
    } catch (e) {
      console.warn('E2E: PostgreSQL unavailable, skipping suite');
      skipSuite = true;
    }
  });

  afterAll(async () => {
    if (skipSuite) return;
    await pool.query('TRUNCATE TABLE messages RESTART IDENTITY');
    await pool.end();
  });

  it('сохраняет сообщения пользователя и ассистента в PostgreSQL', async () => {
    if (skipSuite) {
      console.warn('E2E тест пропущен: отсутствует соединение с PostgreSQL.');
      return;
    }

    const sessionId = uuidv4();

    const response = await request(app)
      .post('/chat')
      .send({
        message: 'Привет из e2e',
        sessionId,
      });

    expect(response.status).toBe(200);
    expect(response.body.response).toBe('E2E response');
    expect(llmClient.generate).toHaveBeenCalledTimes(1);

    const { rows } = await pool.query(
      'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY timestamp ASC',
      [sessionId],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({
      role: 'user',
      content: 'Привет из e2e',
    }));
    expect(rows[1]).toEqual(expect.objectContaining({
      role: 'assistant',
      content: 'E2E response',
    }));
  });
});
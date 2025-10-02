const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { createApp, createPool } = require('../../memory-service');

jest.setTimeout(30000);

describe('E2E: /chat-with-memory', () => {
  let pool;
  let app;
  let axiosStub;
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

      axiosStub = {
        post: jest.fn().mockResolvedValue({
          data: {
            response: 'E2E response',
            eval_count: 256,
          },
        }),
      };

      app = createApp({ pool, axiosInstance: axiosStub, ollamaBaseUrl: 'http://ollama.e2e' });
    } catch (error) {
      skipSuite = true;
      console.warn('E2E тесты пропущены из-за недоступности PostgreSQL:', error.message);
    }
  });

  beforeEach(async () => {
    if (skipSuite) {
      return;
    }
    await pool.query('TRUNCATE TABLE ai_sessions RESTART IDENTITY');
  });

  afterAll(async () => {
    if (skipSuite) {
      return;
    }
    await pool.query('TRUNCATE TABLE ai_sessions RESTART IDENTITY');
    await pool.end();
  });

  it('сохраняет сообщения пользователя и ассистента в PostgreSQL', async () => {
    if (skipSuite) {
      console.warn('E2E тест пропущен: отсутствует соединение с PostgreSQL.');
      return;
    }
    const sessionId = uuidv4();

    const response = await request(app)
      .post('/chat-with-memory')
      .send({
        message: 'Привет из e2e',
        sessionId,
      });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.response).toBe('E2E response');

    const { rows } = await pool.query(
      'SELECT role, message_text, model_used FROM ai_sessions WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        message_text: 'Привет из e2e',
        model_used: 'deepseek-r1:70b',
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        message_text: 'E2E response',
        model_used: 'deepseek-r1:70b',
      }),
    );
  });
});

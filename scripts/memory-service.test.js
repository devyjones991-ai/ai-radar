const request = require('supertest');

const mockPgPool = {
  query: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPgPool),
}));

jest.mock('./llm-client', () => ({
  generate: jest.fn(),
  MOCK_COMPLETION: { response: 'Mocked LLM response', evalCount: 0 },
  DISABLED_COMPLETION: { response: 'LLM service is disabled', evalCount: 0 },
}));

const llmClient = require('./llm-client');
const { createApp, chatWithMemoryHandler } = require('./memory-service');

function createResponse() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn().mockImplementation(code => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation(body => {
    res.body = body;
    return res;
  });
  return res;
}

describe('memory-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('chatWithMemoryHandler использует переданные зависимости', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: 'system', message_text: 'hi' }] })
        .mockResolvedValue({ rows: [] }),
    };

    llmClient.generate.mockResolvedValue({ response: 'Ответ', evalCount: 5 });

    const handler = chatWithMemoryHandler({ pool, llmClient });

    const req = {
      body: {
        message: 'Привет',
        sessionId: 'session-1',
        model: 'test-model',
        options: { temperature: 0.1 },
      },
    };
    const res = createResponse();

    await handler(req, res);

    expect(pool.query).toHaveBeenCalled();
    expect(llmClient.generate).toHaveBeenCalledWith(expect.any(String), {
      model: 'test-model',
      options: { temperature: 0.1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        response: 'Ответ',
        sessionId: 'session-1',
        model: 'test-model',
      }),
    );
  });

  it('createApp создаёт express приложение и регистрирует маршруты', async () => {
    mockPgPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    llmClient.generate.mockResolvedValue({ response: 'hello', evalCount: 1 });

    const app = createApp();

    const healthResponse = await request(app).get('/health');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe('ok');

    const chatResponse = await request(app)
      .post('/chat-with-memory')
      .send({ message: 'ping', sessionId: 'abc' });

    expect(chatResponse.status).toBe(200);
    expect(chatResponse.body).toHaveProperty('response', 'hello');
    expect(app.pool).toBeDefined();
    expect(typeof app.getSessionContext).toBe('function');
    expect(typeof app.saveMessage).toBe('function');
  });
});

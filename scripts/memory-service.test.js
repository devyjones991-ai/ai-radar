const request = require('supertest');

jest.mock(
  'dotenv',
  () => ({
    config: jest.fn(),
  }),
  { virtual: true }
);

const mockPgPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPgPool),
}));

const mockLlmClient = {
  generate: jest.fn(),
  MOCK_COMPLETION: { response: 'Mocked LLM response', evalCount: 0 },
  DISABLED_COMPLETION: { response: 'LLM service is disabled', evalCount: 0 },
};

jest.mock('./llm-client', () => mockLlmClient);

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
  let getSessionContext;
  let saveMessage;
  let createPool;
  let servicePool;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    ({ getSessionContext, saveMessage, createPool, pool: servicePool } = require('./memory-service'));
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('использует фабрику createPool так же, как остальные тесты', () => {
    const anotherPool = createPool();

    expect(anotherPool).toBe(mockPgPool);
    expect(servicePool).toBe(mockPgPool);
  });

  it('возвращает сообщения из базы данных в хронологическом порядке', async () => {
    const rowsFromDb = [
      { role: 'assistant', message_text: 'Последний ответ', model_used: 'model-a', created_at: '2024-05-02T10:00:00Z' },
      { role: 'user', message_text: 'Первый вопрос', model_used: 'model-a', created_at: '2024-05-02T09:59:00Z' },
    ];
    mockPgPool.query.mockResolvedValueOnce({ rows: [...rowsFromDb] });

    const result = await getSessionContext('session-42', 2);

    expect(mockPgPool.query).toHaveBeenCalledWith(
      'SELECT role, message_text, model_used, created_at FROM ai_sessions WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
      ['session-42', 2]
    );
    expect(result).toEqual(rowsFromDb.slice().reverse());
  });

  it('возвращает пустой массив и логирует ошибку при сбое запроса', async () => {
    const error = new Error('database unavailable');
    mockPgPool.query.mockRejectedValueOnce(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getSessionContext('session-error', 5);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith('Error getting session context:', error);

    consoleSpy.mockRestore();
  });

  it('сохраняет сообщение в базе данных', async () => {
    mockPgPool.query.mockResolvedValueOnce();

    await saveMessage('session-100', 'assistant', 'Ответ с памятью', 'model-b', 64);

    expect(mockPgPool.query).toHaveBeenCalledWith(
      'INSERT INTO ai_sessions (session_id, role, message_text, model_used, tokens_used) VALUES ($1, $2, $3, $4, $5)',
      ['session-100', 'assistant', 'Ответ с памятью', 'model-b', 64]
    );
  });

  it('логирует ошибку при неудачной попытке сохранения сообщения', async () => {
    const error = new Error('insert failed');
    mockPgPool.query.mockRejectedValueOnce(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await saveMessage('session-100', 'user', 'Ошибка', 'model-b', null);

    expect(consoleSpy).toHaveBeenCalledWith('Error saving message:', error);

    consoleSpy.mockRestore();
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
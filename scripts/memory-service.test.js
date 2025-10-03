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

const { createService, createPool } = require('./memory-service');

describe('memory-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('использует фабрику createPool так же, как остальные тесты', () => {
    const { pool } = createService();
    const anotherPool = createPool();

    expect(anotherPool).toBe(mockPgPool);
    expect(pool).toBe(mockPgPool);
  });

  it('возвращает сообщения из базы данных в хронологическом порядке', async () => {
    const rowsFromDb = [
      { role: 'assistant', message_text: 'Последний ответ', model_used: 'model-a', tokens_used: 42, created_at: '2024-05-02T10:00:00Z' },
      { role: 'user', message_text: 'Первый вопрос', model_used: 'model-a', tokens_used: 11, created_at: '2024-05-02T09:59:00Z' },
    ];
    mockPgPool.query.mockResolvedValueOnce({ rows: [...rowsFromDb] });

    const service = createService();
    const result = await service.getSessionContext('session-42', 2);

    expect(mockPgPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT role, message_text, model_used, tokens_used, created_at'),
      ['session-42', 2]
    );
    expect(result).toEqual(rowsFromDb.slice().reverse());
  });

  it('возвращает пустой массив и логирует ошибку при сбое запроса', async () => {
    const error = new Error('database unavailable');
    mockPgPool.query.mockRejectedValueOnce(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const service = createService();
    const result = await service.getSessionContext('session-error', 5);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith('Error getting session context:', error);

    consoleSpy.mockRestore();
  });

  it('сохраняет сообщение в базе данных', async () => {
    mockPgPool.query.mockResolvedValueOnce();

    const service = createService();
    await service.saveMessage('session-100', 'assistant', 'Ответ с памятью', 'model-b', 64);

    expect(mockPgPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_sessions'),
      ['session-100', 'assistant', 'Ответ с памятью', 'model-b', 64]
    );
  });

  it('логирует ошибку и пробрасывает исключение при неудачной попытке сохранения сообщения', async () => {
    const error = new Error('insert failed');
    mockPgPool.query.mockRejectedValueOnce(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const service = createService();

    await expect(service.saveMessage('session-100', 'user', 'Ошибка', 'model-b', null)).rejects.toThrow('insert failed');
    expect(consoleSpy).toHaveBeenCalledWith('Error saving message:', error);

    consoleSpy.mockRestore();
  });

  it('обрабатывает чат через реальный маршрут и использует переданные зависимости', async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: 'system', message_text: 'hi there' }] })
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(),
    };
    const llm = {
      generate: jest.fn().mockResolvedValue({ response: 'Ответ', evalCount: 5, model: 'test-model' }),
    };

    const { app } = createService({ pool, llmClient: llm, defaultModel: 'fallback-model' });

    const chatResponse = await request(app)
      .post('/chat')
      .send({ message: 'Привет', sessionId: 'session-1', model: 'test-model', options: { temperature: 0.1 } });

    expect(chatResponse.status).toBe(200);
    expect(chatResponse.body).toEqual(
      expect.objectContaining({
        response: 'Ответ',
        sessionId: 'session-1',
        model: 'test-model',
        contextUsed: true,
        evalCount: 5,
        llmDisabled: false,
      })
    );

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT role, message_text, model_used, tokens_used, created_at'),
      ['session-1', 10]
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO ai_sessions'),
      ['session-1', 'user', 'Привет', 'test-model', null]
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO ai_sessions'),
      ['session-1', 'assistant', 'Ответ', 'test-model', 5]
    );

    expect(llm.generate).toHaveBeenCalledWith(
      'system: hi there\nuser: Привет',
      {
        model: 'test-model',
        options: { temperature: 0.1 },
      }
    );
  });

  it('создает express приложение и регистрирует маршруты /health и /chat', async () => {
    mockPgPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce()
      .mockResolvedValueOnce();
    mockLlmClient.generate.mockResolvedValue({ response: 'hello', evalCount: 1, model: 'deepseek-r1:70b' });

    const { app, pool } = createService({ defaultModel: 'deepseek-r1:70b' });

    const healthResponse = await request(app).get('/health');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe('ok');

    const chatResponse = await request(app).post('/chat').send({ message: 'ping', sessionId: 'abc' });

    expect(chatResponse.status).toBe(200);
    expect(chatResponse.body).toEqual(
      expect.objectContaining({
        response: 'hello',
        sessionId: 'abc',
        model: 'deepseek-r1:70b',
      })
    );

    expect(pool).toBe(mockPgPool);
    expect(typeof app.getSessionContext).toBe('function');
    expect(typeof app.saveMessage).toBe('function');
  });
});

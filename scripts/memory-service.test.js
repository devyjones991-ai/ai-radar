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

describe('memory-service вспомогательные функции', () => {
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
});


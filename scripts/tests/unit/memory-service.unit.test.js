const request = require('supertest');
const { createService } = require('../../memory-service');

describe('Memory service unit tests', () => {
  let poolMock;
  let llmClientMock;
  let service;
  let app;

  beforeEach(() => {
    poolMock = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(),
    };
    llmClientMock = {
      generate: jest.fn().mockResolvedValue({
        response: 'Привет! Чем могу помочь?',
        evalCount: 128,
        disabled: false,
        model: 'test-model',
      }),
    };
    service = createService({
      pool: poolMock,
      llmClient: llmClientMock,
      defaultModel: 'test-model',
    });
    app = service.app;
  });

  it('возвращает успешный ответ на /health', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('формирует запрос к LLM и сохраняет сообщения', async () => {
    const payload = {
      message: 'Расскажи мне что-нибудь',
      sessionId: 'unit-test-session',
      model: 'test-model',
      options: {
        temperature: 0.7,
      },
    };

    const response = await request(app).post('/chat').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.response).toBe('Привет! Чем могу помочь?');
    expect(response.body.sessionId).toBe(payload.sessionId);
    expect(response.body.model).toBe(payload.model);
    expect(response.body.contextUsed).toBe(false);
    expect(response.body.evalCount).toBe(128);
    expect(response.body.llmDisabled).toBe(false);

    expect(llmClientMock.generate).toHaveBeenCalledWith('user: Расскажи мне что-нибудь', {
      model: payload.model,
      options: expect.objectContaining({
        temperature: 0.7,
      }),
    });

    expect(poolMock.query).toHaveBeenCalledTimes(3);
    expect(poolMock.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT role, message_text, model_used, tokens_used, created_at'),
      [payload.sessionId, 10]
    );
    expect(poolMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO ai_sessions'),
      [payload.sessionId, 'user', payload.message, payload.model, null]
    );
    expect(poolMock.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO ai_sessions'),
      [payload.sessionId, 'assistant', 'Привет! Чем могу помочь?', payload.model, 128]
    );
  });
});

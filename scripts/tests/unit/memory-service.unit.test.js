const request = require('supertest');
const { createApp } = require('../../memory-service');

describe('Memory service unit tests', () => {
  let poolMock;
  let axiosMock;
  let app;

  beforeEach(() => {
    poolMock = {
      query: jest.fn(),
    };
    axiosMock = {
      post: jest.fn(),
    };
    app = createApp({
      pool: poolMock,
      axiosInstance: axiosMock,
      ollamaBaseUrl: 'http://ollama.test',
    });
  });

  it('возвращает успешный ответ на /health', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('формирует запрос к Ollama и сохраняет сообщения', async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    axiosMock.post.mockResolvedValue({
      data: {
        response: 'Привет! Чем могу помочь?',
        eval_count: 128,
      },
    });

    const payload = {
      message: 'Расскажи мне что-нибудь',
      sessionId: 'unit-test-session',
      model: 'test-model',
      options: {
        temperature: 0.7,
      },
    };

    const response = await request(app).post('/chat-with-memory').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.response).toBe('Привет! Чем могу помочь?');
    expect(response.body.sessionId).toBe(payload.sessionId);
    expect(response.body.model).toBe(payload.model);
    expect(response.body.contextUsed).toBe(false);

    expect(axiosMock.post).toHaveBeenCalledWith('http://ollama.test/api/generate', {
      model: payload.model,
      prompt: 'user: Расскажи мне что-нибудь',
      stream: false,
      options: expect.objectContaining({
        temperature: 0.7,
        top_p: 0.9,
      }),
    });

    expect(poolMock.query).toHaveBeenCalledTimes(3);
    expect(poolMock.query).toHaveBeenNthCalledWith(
      1,
      'SELECT role, message_text, model_used, created_at FROM ai_sessions WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
      [payload.sessionId, 10],
    );
  });
});

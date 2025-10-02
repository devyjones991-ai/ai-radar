const request = require('supertest');
const { createApp } = require('../../memory-service');

describe('Smoke: /chat-with-memory', () => {
  it('возвращает корректный JSON ответ', async () => {
    const poolStub = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const llmStub = {
      generate: jest.fn().mockResolvedValue({
        response: 'smoke-response',
        evalCount: 10,
      }),
    };

    const app = createApp({ pool: poolStub, llm: llmStub });

    const response = await request(app)
      .post('/chat-with-memory')
      .send({ message: 'ping', sessionId: 'smoke-session' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        response: 'smoke-response',
        sessionId: 'smoke-session',
        model: 'deepseek-r1:70b',
      }),
    );
  });
});

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

    const llmClientStub = {
      generate: jest.fn().mockResolvedValue({
        response: 'smoke-response',
        evalCount: 10,
        disabled: false,
      }),
    };

    const app = createApp({ pool: poolStub, llmClient: llmClientStub });

    const response = await request(app)
      .post('/chat-with-memory')
      .send({
        message: 'ping',
        sessionId: 'smoke-session',
        options: { temperature: 0, top_p: 0 },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        response: 'smoke-response',
        sessionId: 'smoke-session',
        model: 'deepseek-r1:70b',
        evalCount: 10,
        llmDisabled: false,
      }),
    );

    expect(llmClientStub.generate).toHaveBeenCalledWith('user: ping', {
      model: 'deepseek-r1:70b',
      options: expect.objectContaining({ temperature: 0, top_p: 0 }),
    });
  });
});

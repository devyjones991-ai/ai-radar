const request = require('supertest');
const { createService } = require('../../memory-service');

describe('Smoke: /chat', () => {
  it('возвращает корректный JSON ответ', async () => {
    const poolStub = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce()
        .mockResolvedValueOnce(),
    };

    const llmClientStub = {
      generate: jest.fn().mockResolvedValue({
        response: 'smoke-response',
        evalCount: 10,
        disabled: false,
        model: 'smoke-model',
      }),
    };

    const { app } = createService({ pool: poolStub, llmClient: llmClientStub, defaultModel: 'smoke-model' });

    const response = await request(app)
      .post('/chat')
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
        model: 'smoke-model',
        contextUsed: false,
        evalCount: 10,
        llmDisabled: false,
      })
    );

    expect(llmClientStub.generate).toHaveBeenCalledWith('user: ping', {
      model: 'smoke-model',
      options: { temperature: 0, top_p: 0 },
    });
    expect(poolStub.query).toHaveBeenCalledTimes(3);
  });
});

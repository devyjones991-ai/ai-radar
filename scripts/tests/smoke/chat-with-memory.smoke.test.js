const request = require('supertest');
const { createService } = require('../../memory-service');

describe('Smoke: /chat', () => {
  it('возвращает корректный JSON ответ', async () => {
    const poolStub = {
      query: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const llmClientStub = {
      generate: jest.fn().mockResolvedValue({
        content: 'smoke-response',
      }),
    };

    const { app } = createService({ pool: poolStub, llmClient: llmClientStub });
    const server = app.listen(0);

    try {
      const response = await request(server)
        .post('/chat')
        .send({
          message: 'ping',
          sessionId: 'smoke-session',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ response: 'smoke-response' });
      expect(llmClientStub.generate).toHaveBeenCalledWith({
        prompt: 'ping',
        context: [],
      });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
